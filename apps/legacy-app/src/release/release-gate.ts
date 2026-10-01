export interface TaskRef {
  readonly taskDefinition: string;
  readonly trafficPercent: number;
}

export interface CanaryRef extends TaskRef {
  readonly publicTraffic: boolean;
}

export interface MigrationState {
  readonly id: string;
  readonly state: string;
  readonly writerVersions: readonly string[];
}

export interface ReleaseSnapshot {
  readonly train: string;
  readonly source: string;
  readonly stable: TaskRef;
  readonly canary: CanaryRef;
  readonly migration: MigrationState;
  readonly catalogDigest: string;
  readonly rollbackTarget: string | null;
}

export interface PublishedArtifact {
  readonly catalogDigest: string;
  readonly sourceCommit: string;
  readonly generatedAt: string;
  readonly generator: string;
  readonly runtimeConfigDigest: string;
  readonly notes: readonly string[];
}

export type GateId =
  | 'release_branch_source'
  | 'catalog_digest_published'
  | 'migration_applied'
  | 'rollback_target_valid';

export interface GateResult {
  readonly gate: GateId;
  readonly passed: boolean;
  readonly detail: string;
}

export type ReleaseDecision = 'proceed' | 'wait';

export interface TrainEvaluation {
  readonly train: string;
  readonly decision: ReleaseDecision;
  readonly gates: readonly GateResult[];
  readonly failingGates: readonly GateId[];
}

/** `quotaflow-core:485` -> `485`; returns the segment after the last colon. */
function versionOf(taskDefinition: string): string {
  const colon = taskDefinition.lastIndexOf(':');
  return colon === -1 ? taskDefinition : taskDefinition.slice(colon + 1);
}

/**
 * Deterministic, side-effect-free promotion gate. Reads only the snapshot and
 * the published artifact; performs no I/O and contacts no deployment system.
 */
export function evaluateRelease(
  snapshot: ReleaseSnapshot,
  artifact: PublishedArtifact,
): TrainEvaluation {
  const gates: GateResult[] = [];

  const sourceOk = snapshot.source.startsWith('release/');
  gates.push({
    gate: 'release_branch_source',
    passed: sourceOk,
    detail: sourceOk
      ? `source "${snapshot.source}" is a release branch`
      : `source "${snapshot.source}" is not a release branch`,
  });

  const digestOk = snapshot.catalogDigest === artifact.catalogDigest;
  gates.push({
    gate: 'catalog_digest_published',
    passed: digestOk,
    detail: digestOk
      ? `catalog digest matches the published artifact`
      : `catalog digest "${snapshot.catalogDigest}" does not match published "${artifact.catalogDigest}"`,
  });

  const migrationOk = snapshot.migration.state === 'applied';
  gates.push({
    gate: 'migration_applied',
    passed: migrationOk,
    detail: migrationOk
      ? `migration ${snapshot.migration.id} is applied`
      : `migration ${snapshot.migration.id} is "${snapshot.migration.state}", not applied`,
  });

  const rollbackVersion =
    snapshot.rollbackTarget === null ? null : versionOf(snapshot.rollbackTarget);
  const rollbackOk =
    rollbackVersion !== null && snapshot.migration.writerVersions.includes(rollbackVersion);
  gates.push({
    gate: 'rollback_target_valid',
    passed: rollbackOk,
    detail:
      snapshot.rollbackTarget === null
        ? `rollback target is null`
        : rollbackOk
          ? `rollback target version ${rollbackVersion} is an active writer`
          : `rollback target version ${rollbackVersion} is not among active writers [${snapshot.migration.writerVersions.join(', ')}]`,
  });

  const failingGates = gates.filter((g) => !g.passed).map((g) => g.gate);

  return {
    train: snapshot.train,
    decision: failingGates.length === 0 ? 'proceed' : 'wait',
    gates,
    failingGates,
  };
}
