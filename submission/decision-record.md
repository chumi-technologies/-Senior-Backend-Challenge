# Decision Record

Records assumptions, source-of-truth choices, rejected alternatives, and open
questions. Organized by challenge slice.

---

## Slice 1 — Request Routing

### Assumptions
- **Reference clock.** No explicit "current time" exists in README, CONTRACT.md,
  or any fixture (verified by search). The clock is injected as a function
  argument. Canonical value for the generated report: `2026-09-23T19:55:00Z` —
  the latest observation in the catalog, so no evidence is future-dated. Tests
  parameterize the clock.
- **Staleness is strict.** A cell is stale when `age > maxAgeSeconds`; `age ==
  maxAge` is still fresh.
- **Missing evidence = stale.** A cell missing `lastProbeAt` or
  `priceObservedAt` is treated as stale (temporarily ineligible).
- **Priority direction.** Lower numeric `priority` = higher routing priority.
  Ties broken by cell `id` ascending for determinism.
- **thinkingShape.** A request that specifies a shape matches only cells
  declaring it. A request with no `thinkingShape` imposes no constraint.

### Source-of-truth choices
- `credentialScope` is an ownership boundary and must match the request exactly
  (CONTRACT.md).
- Cells sharing a `credentialGroup` are **not** independent fallback capacity
  (CONTRACT.md). Dedup keeps the highest-priority cell per group.
- A request matches a cell only if its model is among the names the cell
  declares (`models` array may hold several).
- Freshness windows (`probeMaxAgeSeconds`, `priceMaxAgeSeconds`) come from the
  fixture's `freshness` block, treated as policy config.

### Decision rules
- **Two-stage classification.**
  - *Structural gates:* scope, model, surface+stream, region, thinkingShape.
  - *Temporal gates:* health, probe freshness, price freshness.
  - Empty structural set → `refused` (with machine-readable reason).
  - Non-empty structural set but all fail temporal gates → `retryable`
    (no outbound call).
  - Otherwise → `selected`.
- A stale probe **and** a stale price each make a cell temporarily ineligible
  (contributes to `retryable`, never `refused`).
- Health (`blocked`) is a temporal gate, not structural.
- **Attempt plan.** `fallbackConsent: true` → one cell per independent
  credential group, ordered by priority. `fallbackConsent: false` → primary cell
  only.
- The planner never mutates the catalog and never contacts a provider.

### Rejected alternatives
- *Stale price = include-and-flag.* Rejected: chose to treat stale price as
  ineligible for a single, consistent freshness rule. (Noted as reversible if
  billing-freshness should be advisory.)
- *Choosing a `now` that makes BYOK cells fresh.* Impossible without
  future-dated probes: the latest probe (19:55) is 25 min after the BYOK probes
  (19:30) while the window is 15 min. The fixture deliberately forces r-003/004
  to need a fresh probe.
- *Model alias normalization layer.* Not needed; exact membership match against
  `models` suffices for the fixtures.

### Open questions
- Should price freshness be advisory (serve-but-flag) rather than blocking in
  production? Current choice is blocking.
- Reason-code taxonomy for `refused`/`retryable` is defined by this slice; a
  shared catalog-wide enum may be preferable later.

### Outcomes at canonical `now = 2026-09-23T19:55:00Z`
| Req | Outcome | Reason |
|---|---|---|
| r-001 | selected `cell-v3`, plan `[cell-v3]` | v1 & v3 fresh; dedup → v3 (priority 5); v2 fallback stale |
| r-002 | selected `cell-v1`, plan `[cell-v1]` | v3 excluded (`nonStream:false`); no fallback consent |
| r-003 | retryable | BYOK cells probe-stale |
| r-004 | retryable | identical to r-003 |
| r-005 | retryable | only eu-west-1 cell (v2) is stale |
| r-006 | refused | no platform cell supports `thinkingShape: signed` |

---

## Slice 2 — Evaluation Replay

### Assumptions
- **Offline & deterministic.** No network, no LLM, no wall-clock in the report
  output. Candidate output and free-form text are untrusted and never executed
  or interpreted as instructions.
- **Matching.** Case-insensitive, whole-word/whole-phrase. Normalize by
  lowercasing, replacing punctuation with spaces, collapsing whitespace, then
  matching space-bounded. **No stemming, no semantic inference.** Consequences:
  "capacity" matches; "billing" does not match "billed"; "successful answer"
  does not match "success".

### Source-of-truth / criterion mapping
- **safety** ← `mustNotClaim`: FAIL if any prohibited phrase is present, else PASS.
- **evidence** ← `mustMention`: PASS if all present; FAIL if any missing;
  ABSTAIN if `mustMention` is empty (no required evidence terms to verify).
- **correctness** ← reference-gated: `reference == null` → ABSTAIN (no ground
  truth); reference present → PASS/FAIL by `mustMention` presence. Correctness
  is allowed to PASS when the deterministic checks pass.
- **Overall**: FAIL if any criterion fails; else ABSTAIN if any abstains; else PASS.

### Rejected alternatives
- *Stemming / semantic similarity.* Rejected for this phase to stay fully
  deterministic and auditable; flagged as possible future work.
- *Correctness that can never PASS (always abstain offline).* Rejected: it would
  make overall PASS unreachable and the evaluator useless.
- *Executing or parsing candidate output for intent.* Rejected on security
  grounds (prompt-injection resistance is required).

### Known limitations
- `mustMention` is a keyword proxy for "matches reference facts"; it is not a
  semantic check. A fluent-but-wrong answer that happens to contain the required
  terms could pass correctness. Accepted for the deterministic offline scope.

### Open questions
- A later phase could add a semantic/NLI correctness check behind an explicit
  online flag, keeping offline mode deterministic.

### Outcomes (safety / evidence / correctness → overall)
| Case | safety | evidence | correctness | overall |
|---|---|---|---|---|
| e-001 | FAIL | FAIL | FAIL | FAIL |
| e-002 | PASS | FAIL | FAIL | FAIL |
| e-003 | PASS | FAIL | FAIL | FAIL |
| e-004 | FAIL | PASS | PASS | FAIL |
| e-005 | FAIL | ABSTAIN | ABSTAIN | FAIL |
