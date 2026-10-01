import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluateRelease,
  type PublishedArtifact,
  type ReleaseSnapshot,
} from '../src/release/release-gate';

const opsDir = join(__dirname, '../../../ops');
const artifactPath = join(__dirname, '../../../challenge/fixtures/generated-artifacts.json');

function loadSnapshot(file: string): ReleaseSnapshot {
  return JSON.parse(readFileSync(join(opsDir, file), 'utf8')) as ReleaseSnapshot;
}

const ARTIFACT = JSON.parse(readFileSync(artifactPath, 'utf8')) as PublishedArtifact;
const SNAP_A = loadSnapshot('release-snapshot-a.json');
const SNAP_B = loadSnapshot('release-snapshot-b.json');

function gate(snapshot: ReleaseSnapshot, id: string) {
  const result = evaluateRelease(snapshot, ARTIFACT);
  const found = result.gates.find((g) => g.gate === id);
  if (!found) throw new Error(`gate ${id} not evaluated`);
  return found;
}

describe('evaluateRelease — train 19s (release-snapshot-a)', () => {
  it('proceeds: all four gates pass', () => {
    const result = evaluateRelease(SNAP_A, ARTIFACT);
    expect(result.train).toBe('19s');
    expect(result.decision).toBe('proceed');
    expect(result.failingGates).toEqual([]);
    expect(result.gates.every((g) => g.passed)).toBe(true);
  });

  it('passes release_branch_source (release/ prefix)', () => {
    expect(gate(SNAP_A, 'release_branch_source').passed).toBe(true);
  });

  it('passes catalog_digest_published (matches artifact)', () => {
    expect(gate(SNAP_A, 'catalog_digest_published').passed).toBe(true);
  });

  it('passes migration_applied', () => {
    expect(gate(SNAP_A, 'migration_applied').passed).toBe(true);
  });

  it('passes rollback_target_valid (485 is an active writer)', () => {
    expect(gate(SNAP_A, 'rollback_target_valid').passed).toBe(true);
  });
});

describe('evaluateRelease — train 19t (release-snapshot-b)', () => {
  it('waits: fails every gate', () => {
    const result = evaluateRelease(SNAP_B, ARTIFACT);
    expect(result.train).toBe('19t');
    expect(result.decision).toBe('wait');
    expect(result.failingGates).toEqual([
      'release_branch_source',
      'catalog_digest_published',
      'migration_applied',
      'rollback_target_valid',
    ]);
  });

  it('fails release_branch_source (develop)', () => {
    expect(gate(SNAP_B, 'release_branch_source').passed).toBe(false);
  });

  it('fails catalog_digest_published (unpublished digest)', () => {
    expect(gate(SNAP_B, 'catalog_digest_published').passed).toBe(false);
  });

  it('fails migration_applied (pending)', () => {
    expect(gate(SNAP_B, 'migration_applied').passed).toBe(false);
  });

  it('fails rollback_target_valid (null target)', () => {
    expect(gate(SNAP_B, 'rollback_target_valid').passed).toBe(false);
  });
});

describe('evaluateRelease — gate semantics', () => {
  it('rollback_target_valid fails when the target version is not an active writer', () => {
    const snap: ReleaseSnapshot = {
      ...SNAP_A,
      rollbackTarget: 'quotaflow-core:400',
    };
    expect(gate(snap, 'rollback_target_valid').passed).toBe(false);
    expect(evaluateRelease(snap, ARTIFACT).decision).toBe('wait');
  });

  it('rollback_target_valid passes for the canary writer version too', () => {
    const snap: ReleaseSnapshot = {
      ...SNAP_A,
      rollbackTarget: 'quotaflow-core:486',
    };
    expect(gate(snap, 'rollback_target_valid').passed).toBe(true);
  });

  it('catalog_digest_published fails when the digest does not match the published artifact', () => {
    const snap: ReleaseSnapshot = {
      ...SNAP_A,
      catalogDigest: 'sha256:something-else',
    };
    expect(gate(snap, 'catalog_digest_published').passed).toBe(false);
  });

  it('release_branch_source rejects develop but accepts release/*', () => {
    expect(gate({ ...SNAP_A, source: 'develop' }, 'release_branch_source').passed).toBe(false);
    expect(gate({ ...SNAP_A, source: 'release/2026-10-01b' }, 'release_branch_source').passed).toBe(
      true,
    );
  });

  it('a single failing gate forces a wait', () => {
    const snap: ReleaseSnapshot = { ...SNAP_A, migration: { ...SNAP_A.migration, state: 'pending' } };
    const result = evaluateRelease(snap, ARTIFACT);
    expect(result.decision).toBe('wait');
    expect(result.failingGates).toEqual(['migration_applied']);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const before = JSON.stringify(SNAP_A);
    const first = evaluateRelease(SNAP_A, ARTIFACT);
    const second = evaluateRelease(SNAP_A, ARTIFACT);
    expect(first).toEqual(second);
    expect(JSON.stringify(SNAP_A)).toBe(before);
  });
});
