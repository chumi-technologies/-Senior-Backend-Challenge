export interface FreshnessConfig {
  readonly probeMaxAgeSeconds: number;
  readonly priceMaxAgeSeconds: number;
}

export interface RouteRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly model: string;
  readonly surface: string;
  readonly stream: boolean;
  readonly region: string;
  readonly fallbackConsent: boolean;
  readonly credentialScope: string;
  readonly thinkingShape?: string;
}

export interface SurfaceCapability {
  readonly stream: boolean;
  readonly nonStream: boolean;
}

export interface RouteCell {
  readonly id: string;
  readonly vendor: string;
  readonly credentialGroup: string;
  readonly credentialScope: string;
  readonly models: readonly string[];
  readonly surfaces: Readonly<Record<string, SurfaceCapability>>;
  readonly regions: readonly string[];
  readonly health: string;
  readonly lastProbeAt?: string;
  readonly priceObservedAt?: string;
  readonly pricePerMillionInput?: number;
  readonly priority: number;
  readonly thinkingShapes?: readonly string[];
}

export type RefusalReason = 'no_structural_candidate';
export type RetryableReason = 'candidates_temporarily_unavailable';

export interface SelectedResult {
  readonly outcome: 'selected';
  readonly cell: string;
  readonly attemptPlan: readonly string[];
}

export interface RefusedResult {
  readonly outcome: 'refused';
  readonly reason: RefusalReason;
}

export interface RetryableResult {
  readonly outcome: 'retryable';
  readonly reason: RetryableReason;
}

export type RoutePlanResult = SelectedResult | RefusedResult | RetryableResult;

function isStructuralMatch(request: RouteRequest, cell: RouteCell): boolean {
  if (cell.credentialScope !== request.credentialScope) return false;
  if (!cell.models.includes(request.model)) return false;
  if (!cell.regions.includes(request.region)) return false;

  const capability = cell.surfaces[request.surface];
  if (!capability) return false;
  if (request.stream ? !capability.stream : !capability.nonStream) return false;

  if (request.thinkingShape !== undefined) {
    if (!cell.thinkingShapes?.includes(request.thinkingShape)) return false;
  }

  return true;
}

function ageExceeds(observedAt: string | undefined, maxAgeSeconds: number, now: Date): boolean {
  if (observedAt === undefined) return true;
  const ageSeconds = (now.getTime() - new Date(observedAt).getTime()) / 1000;
  return ageSeconds > maxAgeSeconds;
}

function isTemporallyAvailable(cell: RouteCell, config: FreshnessConfig, now: Date): boolean {
  if (cell.health !== 'passing') return false;
  if (ageExceeds(cell.lastProbeAt, config.probeMaxAgeSeconds, now)) return false;
  if (ageExceeds(cell.priceObservedAt, config.priceMaxAgeSeconds, now)) return false;
  return true;
}

function byPriorityThenId(a: RouteCell, b: RouteCell): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Deterministic, side-effect-free route planner.
 * Does not mutate the catalog and never contacts a provider.
 */
export function planRoute(
  request: RouteRequest,
  cells: readonly RouteCell[],
  config: FreshnessConfig,
  now: Date,
): RoutePlanResult {
  const structural = cells.filter((cell) => isStructuralMatch(request, cell));
  if (structural.length === 0) {
    return { outcome: 'refused', reason: 'no_structural_candidate' };
  }

  const available = structural.filter((cell) => isTemporallyAvailable(cell, config, now));
  if (available.length === 0) {
    return { outcome: 'retryable', reason: 'candidates_temporarily_unavailable' };
  }

  const bestPerGroup = new Map<string, RouteCell>();
  for (const cell of available) {
    const incumbent = bestPerGroup.get(cell.credentialGroup);
    if (!incumbent || byPriorityThenId(cell, incumbent) < 0) {
      bestPerGroup.set(cell.credentialGroup, cell);
    }
  }

  const ordered = [...bestPerGroup.values()].sort(byPriorityThenId);
  const planCells = request.fallbackConsent ? ordered : [ordered[0]];

  return {
    outcome: 'selected',
    cell: planCells[0].id,
    attemptPlan: planCells.map((cell) => cell.id),
  };
}
