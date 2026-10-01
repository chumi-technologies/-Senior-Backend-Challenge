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
- **OPEN** — Any normalization/equivalence policy beyond exact name matching (if needed at all).
- **OPEN** — The reference `now` used for freshness. Most freshness outcomes below depend on this.
- **OPEN** — Stale probe → exclude? Stale price → exclude vs. select-and-flag? (Config has both; action is unspecified.)
- **OPEN** — Which situations map to `retryable` vs `refused` (e.g. all candidates stale vs. no candidate ever possible).
- **OPEN** — `thinkingShape` semantics when the request omits it; whether a cell with no `thinkingShapes` serves unshaped requests.
- **OPEN** — Priority ordering direction (assumed lower = higher) and tie-breaking; attempt-plan length.
- Filtering order is an implementation detail (not a decision) unless it changes observable behavior.

### Fixture outcomes
Clock-independent (**REQUIRED** regardless of decisions):
- `cell-blocked` never eligible (`health: blocked`).
- `cell-v3` ineligible for `r-002` (`stream:false`, v3 has `nonStream:false`).
- One cell max per `credentialGroup` in any attempt plan (v1 & v3 share `novaris-shared-1`).
- `r-002` (`fallbackConsent:false`) → attempt plan cannot include a fallback.
- `r-006` → not servable: needs `platform` scope **and** signed thinking; only signed cell is `byok:northwind` scope. (reason code = OPEN.)
- BYOK requests (`r-003/004`) only match BYOK-scoped cells; platform requests never match BYOK cells.

Depends on OPEN decisions (clock + stale-price policy):
- Whether `cell-v2` (older probe/price) is eligible for `r-005` (only eu-west-1 cell).
- Whether `cell-byok` passes freshness for `r-003/004`.
- Whether any request ends up `retryable` (all candidates stale) rather than `selected`.

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
- [ ] Run `pnpm install`
- [ ] Run `pnpm test` (confirm baseline green)
- [ ] Run `pnpm run verify:challenge`

### Phase 1 — Routing
- [ ] Understand evidence (fixtures + CONTRACT re-read)
- [ ] Decide OPEN items (clock, stale-price policy, retryable vs refused, thinkingShape, priority)
- [ ] Record decisions in `decision-record.md`
- [ ] Write tests (REQUIRED outcomes first, then clock-parameterized)
- [ ] Implement `route-planner.ts`
- [ ] Verify tests pass

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
