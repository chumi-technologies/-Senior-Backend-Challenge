# Release & CI Runbook

Scope: the two release snapshots in `ops/` and the generated artifact notes in
`challenge/fixtures/generated-artifacts.json`. The promotion gate is encoded in
`scripts/check-release-plan.ts` (logic in
`apps/legacy-app/src/release/release-gate.ts`).

## Promotion gate (four hard blockers)

A train may **proceed** only if all four pass; otherwise it must **wait**:

1. **Release-branch source** — `source` starts with `release/` (not `develop`).
2. **Published catalog digest** — snapshot `catalogDigest` equals the published
   digest in `generated-artifacts.json`.
3. **Migration applied** — `migration.state === "applied"`.
4. **Valid rollback target** — `rollbackTarget` is non-null and its version
   (`quotaflow-core:485` → `485`) is among the active `writerVersions`.

A matching digest proves catalog + model-fact identity only; per the artifact
note it does **not** prove a provider was reachable. Canary health is separate
evidence (see below).

## 1. Which train may proceed, which must wait

| Train | 1 source | 2 digest | 3 migration | 4 rollback | Decision |
|---|---|---|---|---|---|
| **19s** | `release/2026-09-23a` ✓ | matches ✓ | applied ✓ | `485` ∈ [485,486] ✓ | **PROCEED** |
| **19t** | `develop` ✗ | unpublished ✗ | pending ✗ | null ✗ | **WAIT** |

**19s may proceed. 19t must wait** — it fails every gate: built from `develop`,
its catalog digest is unpublished, migration 9817 is still pending, and it has
no rollback target.

## 2. What is safe to change while public canary traffic is non-zero

19s runs canary 486 at 10% with `publicTraffic: true`. While public canary
traffic is non-zero, allow **only backward-compatible changes that both the
stable (485) and canary (486) task definitions can serve**:

- Allowed: backward-compatible catalog/runtime-config edits that both writers
  interpret identically.
- Not allowed: schema-breaking migrations, credential-scope changes, or any edit
  that changes the published catalog digest and so invalidates the in-flight
  canary comparison.

Rationale: with both versions serving real traffic, a change only one version
understands splits behavior across users and corrupts the canary signal.

## 3. Choosing a rollback target when an older writer is still running

Migration 9816 is `applied` with `writerVersions: [485, 486]` — both the stable
and canary versions write under it. The rollback target must be **compatible
with every active writer version**, i.e. its version must be in
`writerVersions`. 19s's target `quotaflow-core:485` satisfies this (`485` is an
active writer), so rolling back to 485 is safe: data written by 486 remains
readable under the shared migration.

19t has `rollbackTarget: null` and a pending migration, so there is no safe
rollback target — another reason it must wait.

## 4. Which checks gate a route/catalog change vs. an evaluation change

**Route/catalog change:**
- Catalog digest recomputed and matches the published artifact.
- Route-planner contract tests pass (`route-planner.spec.ts`).
- Probe/price freshness evidence present for affected cells.
- No credential-scope regressions.

**Evaluation change:**
- `rubricVersion` pinned and recorded in the report.
- Evaluator tests pass (`evaluate-replay.spec.ts`).
- Report regenerated (`pnpm run evaluate:replay`) and reviewed.
- Runs offline — no network or LLM calls.

## 5. Evidence recorded

**Before promotion:** the snapshot (task definitions + traffic split), proof the
catalog digest matches the artifact, migration state, the canary health window,
and the rollback target.

**After rollback:** confirmation that traffic shifted to the rollback target,
the active writer versions, the migration state, and a flag for any data written
by the rolled-back-from version so it can be reconciled.

## Executable check

```bash
pnpm run check:release   # prints per-train PROCEED/WAIT + failing gates
```

Exit code: `0` only if every train may proceed; `1` if any train must wait. On
the current fixtures it exits `1` because 19t must wait — a correct refusal, not
a simulated deployment.
