# Design Document — Senior Backend Challenge

Legend: **REQUIRED** (stated in README / CONTRACT / fixtures) · **OPEN** (I still need to decide) · **DECIDED** (I explicitly chose it).
Nothing is DECIDED yet. File locations are **tentative** until confirmed.

---

## 1. Request Routing Slice

**Goal**: Pure, deterministic planner that returns, per request, a selected cell + attempt plan, an explicit refusal, or a retryable (no-outbound-call) outcome.

**Inputs**: `routing-cases.json` (6 requests, 7 cells, freshness config) + injectable `now`.
**Outputs**: discriminated result — `selected | refused | retryable` with machine-readable reason.

### Design decisions
- **REQUIRED** — No catalog mutation, no provider contact.
- **REQUIRED** — `credentialScope` must match the request exactly (CONTRACT).
- **REQUIRED** — Two cells sharing a `credentialGroup` are **not** independent fallback capacity (CONTRACT).
- **REQUIRED** — `priority` is an ordering hint only; model/surface/shape/region/health/freshness must all pass first (CONTRACT).
- **REQUIRED** — Freshness values are policy config; clock must be injectable (CONTRACT).
- **REQUIRED** — A request matches a cell only if its model is among the model names the cell declares (a cell may declare several).
- **DECIDED** — Exact name matching only; no normalization/equivalence layer (not needed by the fixtures).
- **DECIDED** — `now` is injected as a function argument. Canonical value for the generated report: `2026-09-23T19:55:00Z` (latest observation in the catalog; no evidence is future-dated). Tests parameterize it.
- **DECIDED** — Staleness is strict: a cell is stale when `age > maxAgeSeconds` (so `age == maxAge` is still fresh).
- **DECIDED** — A stale probe makes a cell temporarily ineligible. A stale price also makes a cell temporarily ineligible. Missing `lastProbeAt`/`priceObservedAt` is treated as stale.
- **DECIDED** — Two-stage classification. Structural gates = scope, model, surface+stream, region, thinkingShape. Temporal gates = health, probe freshness, price freshness. Empty structural set → `refused`. Non-empty structural set but all fail temporal gates → `retryable`. Otherwise → `selected`. (Health is temporary, not structural.)
- **DECIDED** — `thinkingShape`: a request specifying a shape matches only cells that declare it; a request with no `thinkingShape` imposes no constraint (matches any cell).
- **DECIDED** — Lower numeric `priority` = higher routing priority. Tie-break by cell `id` (ascending) for determinism.
- **DECIDED** — Keep only the highest-priority cell per `credentialGroup`. `fallbackConsent: true` → attempt plan = one cell per independent credential group, ordered by priority. `fallbackConsent: false` → primary cell only.
- Filtering order is an implementation detail (not a decision) unless it changes observable behavior.

### Fixture outcomes (at canonical `now = 2026-09-23T19:55:00Z`, strict `>` staleness)
| Req | Outcome | Why |
|---|---|---|
| r-001 | **selected** `cell-v3`, plan `[cell-v3]` | v1 & v3 fresh; dedup `novaris-shared-1` → v3 (priority 5 < 20); v2 fallback probe+price stale |
| r-002 | **selected** `cell-v1`, plan `[cell-v1]` | v3 excluded (`nonStream:false`); `fallbackConsent:false` → primary only |
| r-003 | **retryable** | BYOK cells probe-stale (19:30, 25 min old) |
| r-004 | **retryable** | identical to r-003 |
| r-005 | **retryable** | only eu-west-1 cell is v2; probe+price stale |
| r-006 | **refused** | no platform cell declares `thinkingShape: signed` (structural mismatch) |

Clock-independent invariants (hold regardless of `now`):
- `cell-blocked` never eligible (`health: blocked` is a temporal gate, but always fails here).
- `cell-v3` structurally ineligible for `r-002` (`nonStream:false`).
- One cell max per `credentialGroup` in any attempt plan.
- `r-006` always `refused` (no platform cell supports signed thinking — structural).

### Tests → implement → verify
- Fixture-driven cases for the REQUIRED outcomes above (clock-independent assertions).
- Parameterized clock tests once stale policy is DECIDED.
- Edge cases: empty cell list, all-blocked, all-stale, duplicate credential group.

### Deliverables (tentative locations)
- `apps/legacy-app/src/routing/route-planner.ts` (+ types)
- `apps/legacy-app/test/route-planner.spec.ts` (matches existing jest `testMatch`)

---

## 2. Evaluation Replay Slice

**Goal**: Offline, deterministic evaluator producing a JSON report with case id, per-criterion result, overall decision, and a reason when abstaining.

**Inputs**: `evaluation-cases.json` (criteria: correctness/safety/evidence; per-case reference, rubric `mustMention`/`mustNotClaim`, candidate output).
**Outputs**: `submission/evaluation-report.json`.

### Design decisions
- **REQUIRED** — Candidate output and free-form text are untrusted: never execute it, never let embedded instructions change the rubric or read files.
- **REQUIRED** — Deterministic in offline mode (no network/LLM).
- **REQUIRED** — If reference/rubric is insufficient, represent uncertainty instead of inventing a score.
- **OPEN** — Matching strategy: literal substring vs. word-boundary vs. stemming (affects e-004 `billing` vs. "billed").
- **OPEN** — How case-level `mustMention`/`mustNotClaim` map onto the three named criteria (the rubric is per-case, not per-criterion).
- **OPEN** — Overall aggregation rule. **Not defined anywhere** — do not assume all-pass/any-fail. In particular a single criterion may `abstain` while another `fail`s (see e-005).
- **OPEN** — Whether semantic claims that aren't literal keywords (e-002 "safe to serve", e-003 "success") are detectable at all, or out of scope.

### Fixture outcomes
Literal-rubric, clock-independent (**REQUIRED** signal):
- e-001 — candidate contains "provider was called" → `mustNotClaim` violated; injection text ignored.
- e-002 — missing `mustMention` "probe"/"freshness".
- e-003 — missing `mustMention` "content".
- e-004 — candidate contains "capacity" → `mustNotClaim` violated. ("billing" vs "billed" is OPEN.)
- e-005 — `reference: null` → correctness cannot be established (abstain); candidate contains "promote" → `mustNotClaim` violated. **So one criterion abstains while another fails — the overall result is OPEN until the aggregation rule is DECIDED.**

### Tests → implement → verify
- Per-case criterion assertions for the REQUIRED signals above.
- A test proving embedded instructions do not alter scoring.
- Overall-decision tests added only after the aggregation rule is DECIDED.

### Deliverables (tentative locations)
- `apps/legacy-app/src/evaluation/evaluator.ts` (importable, so jest covers it)
- `apps/legacy-app/test/evaluate-replay.spec.ts`
- `scripts/evaluate-replay.ts` (thin `tsx` CLI; note: `scripts/*` is not run by `pnpm test`)
- `submission/evaluation-report.json`

---

## 3. Release & CI Control

**Goal**: Analyze both snapshots + generated artifacts; write a runbook; add an executable check script.

**Inputs**: `ops/release-snapshot-a.json`, `ops/release-snapshot-b.json`, `challenge/fixtures/generated-artifacts.json`.
**Outputs**: runbook + check script.

### Evidence (facts, not decisions)
| Aspect | 19s (A) | 19t (B) |
|---|---|---|
| Source | `release/2026-09-23a` | `develop` |
| Canary | 10%, public=true | 0%, public=false |
| Migration | 9816 applied, writers [485,486] | 9817 pending, writers [487] |
| Catalog digest | matches generated-artifacts | unpublished, no match |
| Rollback target | `quotaflow-core:485` | null |

### Design decisions (the runbook answers)
- **REQUIRED (to answer)** — which train may proceed / must wait; safe changes while public canary ≠ 0; rollback-target choice with an older writer running; gating checks for route/catalog vs. evaluation changes; evidence before promotion and after rollback.
- **REQUIRED** — Add `scripts/check-release-plan.ts` as an executable check.
- **OPEN** — The actual rules/thresholds I apply to the evidence to reach each answer (e.g. which conditions are hard blockers).
- **OPEN** — The check script's exact blocking rules and its output / exit-code behavior.

### Tests → implement → verify
- Assert the check script blocks 19t and the conditions I mark as blockers; run it and record exit status.

### Deliverables (tentative locations)
- `submission/release-runbook.md`
- `scripts/check-release-plan.ts` (`tsx`)

---

## Phased TODO

Each phase: **understand evidence → make decision → document it → test → implement → verify.**

### Phase 0 — Baseline
- [x] Run `pnpm install` (done in 13.1s, exit 0)
- [x] Run `pnpm test` (shared-types builds; legacy-app 1/1 passed; worker-service no tests — green)
- [x] Run `pnpm run verify:challenge` (all 7 checks ✅, exit 0)

### Phase 1 — Routing
- [x] Understand evidence (fixtures + CONTRACT re-read; walked r-001; confirmed no explicit reference timestamp)
- [x] Decide OPEN items (clock=19:55Z, strict `>`, stale probe+price ineligible, two-stage refused/retryable, thinkingShape, priority lower=higher + id tie-break, dedup/fallback rules)
- [x] Record decisions in `decision-record.md`
- [x] Write tests — 24 specs in `route-planner.spec.ts`; compile & run, red on the stub (`planRoute not implemented`)
- [x] Implement `route-planner.ts` (two-stage filter → group dedup → priority/id sort → attempt plan)
- [x] Verify tests pass — 24/24 green; full `pnpm test` 25/25, exit 0, baseline intact

### Phase 2 — Evaluation
- [ ] Understand evidence (cases + rubric semantics)
- [ ] Decide OPEN items (matching strategy, criterion mapping, aggregation rule, semantic-claim scope)
- [ ] Record decisions in `decision-record.md`
- [ ] Write tests (REQUIRED signals + injection-resistance)
- [ ] Implement evaluator + `evaluate-replay.ts`
- [ ] Generate `evaluation-report.json`; verify tests pass

### Phase 3 — Release
- [ ] Understand evidence (both snapshots + artifacts)
- [ ] Decide blocking rules + script exit-code behavior
- [ ] Document in `release-runbook.md`
- [ ] Write test for check script, implement it, run and record exit status

### Phase 4 — Submission
- [ ] `decision-record.md` complete (assumptions, source-of-truth, rejected alternatives, open questions)
- [ ] `ai-notes.md` complete
- [ ] Run `pnpm test` + `pnpm run verify:challenge`; record commands and exit status
