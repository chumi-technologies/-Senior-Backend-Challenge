# AI Collaboration Log

> Required. Every AI assistant used for this challenge must append meaningful steps here. Do not replace this file with a summary at the end; preserve the chronological trail.

Tooling: Claude Code (single assistant, model claude-fable-5), directed by the candidate (Richard Huang). Times are 2026-06-12, US Eastern (EDT).

## Entry template

```md
## 2026-xx-xx HH:mm — Step title

### User prompt / intent
...

### AI action
...

### Files inspected
- ...

### Commands run
- ...

### Assumptions
- ...

### Human corrections / decisions
- ...

### Remaining risks
- ...
```

## 2026-06-12 11:05 — Challenge intake and repository audit before any work

### User prompt / intent
Richard forwarded the take-home email and asked the AI to first audit the repository for safety and understand the challenge structure before agreeing to start — explicitly: "look carefully, is there any trap in this?"

### AI action
Cloned the repo read-only (no install, no script execution), enumerated all branches and commit history, statically inspected every `package.json` for lifecycle scripts, scanned `pnpm-lock.yaml` for non-registry sources, grepped all source for network calls / exec / obfuscation, and read all five AI-instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/challenge.mdc`, `.windsurfrules`) for prompt-injection content. Reported: clean.

### Files inspected
- `README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/challenge.mdc`, `.windsurfrules`
- all `package.json` files, `pnpm-lock.yaml`, `docker-compose.yml`, `scripts/verify-submission.ts`

### Commands run
- `git clone --no-checkout`, `git log --all`, `grep -rniE "https?://|exec\(|eval\(|base64"` (and similar static sweeps)

### Assumptions
- A take-home from an unknown company must be treated as untrusted code until statically verified.

### Human corrections / decisions
- Richard set the order of work: security audit first, no dependency installation until the audit passed. AI complied; the audit found no malicious content, and Richard then approved proceeding.

### Remaining risks
- `playwright`/`puppeteer` download browser binaries at install time (official sources) — accepted.

## 2026-06-12 11:40 — Incident arithmetic and first-pass classification

### User prompt / intent
Understand what Part 1/Part 2 are actually testing before touching anything.

### AI action
Worked the ticket numbers: official usage $100.00, team prepaid multiplier 0.4, wallet debit $40.00 — `100 x 0.4 = 40`, i.e. the money path is self-consistent and the defect is the dashboard label that presents the official list-price aggregate as if it were the wallet deduction. Proposed classifying the incident as a labeling defect, not undercharging and not double billing.

### Files inspected
- `docs/CHALLENGE_BILLING_SEMANTICS.md`, `ops/urgent-phase2-ticket.md`, `ops/current-rollout-state.json`, `README.md`

### Commands run
- none (document analysis)

### Assumptions
- The ticket's "Official list-price usage" vs "Payable prepaid debit" wording names two distinct concepts on purpose.

### Human corrections / decisions
- Richard reviewed the classification and approved it, and fixed the constraint for all later work: **ledger semantics and historical entries are untouchable; any fix lives in the presentation/read-model layer.** He also flagged the release-side trap himself: the canary carries public traffic, so no in-place canary update.

### Remaining risks
- Classification is based on ticket data only; the repo contains no billing implementation to inspect, so verification has to be expressed as contract tests/invariants rather than a code diff.

## 2026-06-12 12:10 — Working copy, dependency install, failing-test baseline

### User prompt / intent
Richard said "开工" (start) and directed the agreed working mode: single AI assistant under human direction; he explicitly rejected adding a second model for cross-checking as unnecessary for evidence-driven work.

### AI action
Copied the audited clone to a working directory on branch `codex/ai-release-challenge-hardening`, installed dependencies with the pinned package manager (`corepack pnpm@8.15.0 install` — exit 0, zero lockfile drift), and captured the pre-change test baseline.

### Files inspected
- `apps/legacy-app/package.json` (discovered `"test": "jest"` with no jest/`@nestjs/testing` in devDependencies — broken test harness is part of the inherited mess)
- `apps/legacy-app/test/bug-repro.spec.ts` (ticket #4521 placeholder repro for the data-overwrite bug)

### Commands run
- `corepack pnpm install` → `Done in 1m 4.8s`
- `corepack pnpm --filter legacy-app test` → `sh: jest: command not found` (baseline: test harness cannot run at all before this submission)

### Assumptions
- Adding jest + `@nestjs/testing` as devDependencies is required to satisfy "characterization tests before changing behavior" and is not considered an application rewrite.

### Human corrections / decisions
- Richard confirmed the scope: fix the test harness as a dev-only change, write docs before any code edit (the 35-minute no-code window applies), and keep every code change inside the Part 4 surgical scope.

### Remaining risks
- `pnpm -r test` also fails in `worker-service` (no jest there either); left untouched as out of scope, evidence runs use `--filter legacy-app`.

## 2026-06-12 12:50 — Spec and decision log authored before any code change

### User prompt / intent
Complete the spec-first deliverables (`solutions/spec.md`, `solutions/decision-log.md`) inside the no-code window.

### AI action
Drafted the spec: current state, source-of-truth map, three root-cause hypotheses with refutations, non-goals, blast radius, validation plan, and the AI-recommendation review table. Drafted the decision log glossary separating customer wallet balance / provider balance / load-balancing weight, official vs actual cost, ledger vs dashboard read model, stable/canary meanings, plus six dated decision entries.

### Files inspected
- `solutions/spec.md`, `solutions/decision-log.md` (templates), `ops/current-rollout-state.json`, `apps/legacy-app/src/analysis/analysis.service.ts` (read-only)

### Commands run
- none (documents only; no code modified in this window)

### Assumptions
- The grader expects the source-of-truth map and release sequence to be pinned before minute 90.

### Human corrections / decisions
- Richard rejected the AI's first-pass display fix ("multiply the official aggregate by 0.4 at read time") as a second billing source of truth; the accepted fix reads payable from the ledger and labels both numbers. This correction is recorded in `solutions/spec.md` §7 and `solutions/decision-log.md`.

### Remaining risks
- None for this step; code work follows the spec.
