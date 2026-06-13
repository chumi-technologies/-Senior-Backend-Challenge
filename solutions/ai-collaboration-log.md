# AI Collaboration Log

## 2026-06-13 08:30 - Initial triage and work order

- AI suggestion: start by coding a display helper because the numbers clearly match `$100.00 * 0.4 = $40.00`.
- Human corrections / decisions: follow the challenge work order first: complete spec, semantic decisions, release log, and evidence before treating code as the answer.
- Accepted / rejected / why: modified. The arithmetic insight is useful, but coding first would violate the required order and create risk around overloaded billing terms.

## 2026-06-13 08:42 - Billing incident classification

- AI suggestion: consider whether finance is undercharging and whether ledger entries need backfill to `$100.00`.
- Human corrections / decisions: classify the incident as wrong dashboard label / semantic display bug unless duplicate ledger evidence appears.
- Accepted / rejected / why: rejected ledger backfill. The ledger debit `$40.00` matches prepaid multiplier `0.4`, so historical ledger rewrite would damage customer balance source-of-truth.

## 2026-06-13 08:55 - Release interruption decision

- AI suggestion: patch the active canary image in place to meet the 60-minute deadline.
- Human corrections / decisions: freeze or unwind Phase 1 first because canary image B has public traffic and is not promoted.
- Accepted / rejected / why: rejected in-place public canary mutation. The urgent Phase 2 patch should be based on stable image A to keep rollback clean and avoid combining unproven changes.

## 2026-06-13 09:10 - Test strategy

- AI suggestion: use existing `jest` scripts in both services for verification.
- Human corrections / decisions: baseline test showed `jest: command not found`, so use Node built-in test runner with existing `tsx` dependency instead of adding a new test framework.
- Accepted / rejected / why: modified. Keeping tests dependency-light is safer under take-home time pressure and avoids changing package scope for a missing tool.

## 2026-06-13 09:25 - Refactor scope

- AI suggestion: create a complete billing module with rating, ledger, provider settlement, and dashboard APIs.
- Human corrections / decisions: extract at most one pure helper, `buildDashboardCostDisplay`, and verify provider balance/load-balancing pass-through.
- Accepted / rejected / why: rejected broad rewrite. The repository does not contain a full billing gateway; a focused helper plus contract tests proves the intended semantics with minimal blast radius.

## 2026-06-13 09:40 - Scale plan tradeoff

- AI suggestion: consider Rust rewrite or Kubernetes migration for 5M rows in 2 hours.
- Human corrections / decisions: choose chunked object-storage processing, bounded queue workers, idempotent chunk checkpoints, and backpressure.
- Accepted / rejected / why: rejected platform/language rewrite for the two-week constraint. Throughput target is reachable by parallelizing work and controlling downstream pressure before changing the runtime.
