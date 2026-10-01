import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  planRoute,
  type FreshnessConfig,
  type RouteCell,
  type RouteRequest,
  type RoutePlanResult,
} from '../src/routing/route-planner';

const NOW = new Date('2026-09-23T19:55:00Z');
const CFG: FreshnessConfig = { probeMaxAgeSeconds: 900, priceMaxAgeSeconds: 3600 };

function cell(overrides: Partial<RouteCell> = {}): RouteCell {
  return {
    id: 'c1',
    vendor: 'vendor',
    credentialGroup: 'g1',
    credentialScope: 'platform',
    models: ['m1'],
    surfaces: { s1: { stream: true, nonStream: true } },
    regions: ['r1'],
    health: 'passing',
    lastProbeAt: '2026-09-23T19:55:00Z',
    priceObservedAt: '2026-09-23T19:55:00Z',
    pricePerMillionInput: 1,
    priority: 10,
    ...overrides,
  };
}

function req(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    id: 'q1',
    tenantId: 'tenant',
    model: 'm1',
    surface: 's1',
    stream: true,
    region: 'r1',
    fallbackConsent: true,
    credentialScope: 'platform',
    ...overrides,
  };
}

describe('planRoute — routing-cases fixture @ now=2026-09-23T19:55:00Z', () => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, '../../../challenge/fixtures/routing-cases.json'), 'utf8'),
  ) as { freshness: FreshnessConfig; requests: RouteRequest[]; cells: RouteCell[] };

  const config = fixture.freshness;
  const cells = fixture.cells;
  const byId = (id: string) => fixture.requests.find((r) => r.id === id)!;
  const plan = (id: string): RoutePlanResult => planRoute(byId(id), cells, config, NOW);

  it('r-001 selects cell-v3 (dedup novaris-shared-1 by priority), no fresh fallback', () => {
    expect(plan('r-001')).toEqual({
      outcome: 'selected',
      cell: 'cell-v3',
      attemptPlan: ['cell-v3'],
    });
  });

  it('r-002 selects cell-v1 only (v3 is nonStream:false, no fallback consent)', () => {
    expect(plan('r-002')).toEqual({
      outcome: 'selected',
      cell: 'cell-v1',
      attemptPlan: ['cell-v1'],
    });
  });

  it('r-003 is retryable (BYOK cells probe-stale)', () => {
    expect(plan('r-003').outcome).toBe('retryable');
  });

  it('r-004 is retryable and identical to r-003 (determinism)', () => {
    expect(plan('r-004')).toEqual(plan('r-003'));
  });

  it('r-005 is retryable (only eu-west-1 cell is stale)', () => {
    expect(plan('r-005').outcome).toBe('retryable');
  });

  it('r-006 is refused (no platform cell supports thinkingShape:signed)', () => {
    expect(plan('r-006')).toEqual({
      outcome: 'refused',
      reason: 'no_structural_candidate',
    });
  });

  it('does not mutate the catalog', () => {
    const before = JSON.stringify(cells);
    for (const r of fixture.requests) planRoute(r, cells, config, NOW);
    expect(JSON.stringify(cells)).toBe(before);
  });
});

describe('planRoute — structural gates → refused', () => {
  it('empty cell list refuses', () => {
    expect(planRoute(req(), [], CFG, NOW)).toEqual({
      outcome: 'refused',
      reason: 'no_structural_candidate',
    });
  });

  it('model mismatch refuses', () => {
    expect(planRoute(req({ model: 'other' }), [cell()], CFG, NOW).outcome).toBe('refused');
  });

  it('scope mismatch refuses', () => {
    expect(planRoute(req({ credentialScope: 'byok:x' }), [cell()], CFG, NOW).outcome).toBe('refused');
  });

  it('region mismatch refuses', () => {
    expect(planRoute(req({ region: 'elsewhere' }), [cell()], CFG, NOW).outcome).toBe('refused');
  });

  it('surface mismatch refuses', () => {
    expect(planRoute(req({ surface: 'nope' }), [cell()], CFG, NOW).outcome).toBe('refused');
  });

  it('nonStream request against a stream-only cell refuses', () => {
    const streamOnly = cell({ surfaces: { s1: { stream: true, nonStream: false } } });
    expect(planRoute(req({ stream: false }), [streamOnly], CFG, NOW).outcome).toBe('refused');
  });
});

describe('planRoute — thinkingShape', () => {
  it('request with a shape matches only a cell declaring it', () => {
    const signed = cell({ id: 'signed', thinkingShapes: ['signed'] });
    const unsigned = cell({ id: 'unsigned', credentialGroup: 'g2', thinkingShapes: ['unsigned'] });
    const r = planRoute(req({ thinkingShape: 'signed' }), [signed, unsigned], CFG, NOW);
    expect(r).toEqual({ outcome: 'selected', cell: 'signed', attemptPlan: ['signed'] });
  });

  it('request without a shape imposes no constraint (matches a shaped cell)', () => {
    const shaped = cell({ id: 'shaped', thinkingShapes: ['signed'] });
    expect(planRoute(req(), [shaped], CFG, NOW)).toEqual({
      outcome: 'selected',
      cell: 'shaped',
      attemptPlan: ['shaped'],
    });
  });
});

describe('planRoute — temporal gates → retryable', () => {
  it('structurally compatible but blocked health is retryable', () => {
    expect(planRoute(req(), [cell({ health: 'blocked' })], CFG, NOW)).toEqual({
      outcome: 'retryable',
      reason: 'candidates_temporarily_unavailable',
    });
  });

  it('probe exactly at max age is fresh (strict >)', () => {
    const atBoundary = cell({ lastProbeAt: '2026-09-23T19:40:00Z' }); // 900s old
    expect(planRoute(req(), [atBoundary], CFG, NOW).outcome).toBe('selected');
  });

  it('probe one second past max age is stale → retryable', () => {
    const past = cell({ lastProbeAt: '2026-09-23T19:39:59Z' }); // 901s old
    expect(planRoute(req(), [past], CFG, NOW).outcome).toBe('retryable');
  });

  it('stale price alone makes a cell retryable', () => {
    const stalePrice = cell({ priceObservedAt: '2026-09-23T18:00:00Z' }); // >3600s
    expect(planRoute(req(), [stalePrice], CFG, NOW).outcome).toBe('retryable');
  });

  it('missing probe timestamp is treated as stale → retryable', () => {
    const noProbe = cell({ lastProbeAt: undefined });
    expect(planRoute(req(), [noProbe], CFG, NOW).outcome).toBe('retryable');
  });
});

describe('planRoute — credential groups, priority, fallback', () => {
  it('keeps only the highest-priority cell per credential group', () => {
    const low = cell({ id: 'low', priority: 20 });
    const high = cell({ id: 'high', priority: 5 }); // same group g1
    expect(planRoute(req(), [low, high], CFG, NOW)).toEqual({
      outcome: 'selected',
      cell: 'high',
      attemptPlan: ['high'],
    });
  });

  it('fallbackConsent=true builds one cell per independent group, ordered by priority', () => {
    const a = cell({ id: 'a', credentialGroup: 'g1', priority: 20 });
    const b = cell({ id: 'b', credentialGroup: 'g2', priority: 10 });
    expect(planRoute(req({ fallbackConsent: true }), [a, b], CFG, NOW)).toEqual({
      outcome: 'selected',
      cell: 'b',
      attemptPlan: ['b', 'a'],
    });
  });

  it('fallbackConsent=false returns the primary cell only', () => {
    const a = cell({ id: 'a', credentialGroup: 'g1', priority: 20 });
    const b = cell({ id: 'b', credentialGroup: 'g2', priority: 10 });
    expect(planRoute(req({ fallbackConsent: false }), [a, b], CFG, NOW)).toEqual({
      outcome: 'selected',
      cell: 'b',
      attemptPlan: ['b'],
    });
  });

  it('ties on priority break by cell id ascending (determinism)', () => {
    const z = cell({ id: 'z', credentialGroup: 'gz', priority: 10 });
    const a = cell({ id: 'a', credentialGroup: 'ga', priority: 10 });
    const r = planRoute(req({ fallbackConsent: true }), [z, a], CFG, NOW);
    expect(r).toEqual({ outcome: 'selected', cell: 'a', attemptPlan: ['a', 'z'] });
  });
});
