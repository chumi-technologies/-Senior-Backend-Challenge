# AI Collaboration Log

> Required. Every AI assistant used for this challenge appends meaningful steps here in chronological order. Human corrections and rejections are recorded explicitly.

## 2026-06-15 09:00 — Read challenge spec and map repository

### User prompt / intent
Understand the challenge, the codebase structure, and what each scored task requires.

### AI action
Read README.md, AGENTS.md, the docs/ challenge prompts, ops/ state files, and the source under apps/. Produced a repository map and identified the spec-first delivery order.

### Files inspected
- README.md, AGENTS.md, CLAUDE.md
- docs/CHALLENGE_BILLING_SEMANTICS.md, docs/CHALLENGE_RELEASE_INTERRUPTION.md
- ops/current-rollout-state.json, ops/urgent-phase2-ticket.md
- scripts/verify-submission.ts

### Commands run
- (read-only exploration; no commands)

### Assumptions
- The 8 `solutions/*.md` files are empty templates that must be filled.

### Human corrections / decisions
- Human directed: pin source-of-truth and the release sequence first, and ensure `pnpm run verify:submission` ultimately passes. Adopted spec-first ordering accordingly.

### Remaining risks
- Verify script also enforces content patterns; must avoid leaving any template placeholder rows.

## 2026-06-15 09:10 — Triage the $100 vs $40 billing incident

### User prompt / intent
Decide whether the dashboard/wallet discrepancy is a wrong debit, wrong label, wrong aggregate, or double billing.

### AI action
Computed `$100.00 × 0.4 = $40.00` and proposed classifying it as a dashboard label defect with the money paths correct.

### Files inspected
- docs/CHALLENGE_BILLING_SEMANTICS.md
- ops/urgent-phase2-ticket.md

### Commands run
- (analysis only)

### Assumptions
- `officialCost` and `payableAmount` are distinct stored fields.

### Human corrections / decisions
- AI initially suggested editing the ledger debit up to $100 to match the dashboard. Human REJECTED this: the $40 debit is correct; the label is the defect. Recorded in decision-log.md.

### Remaining risks
- Customer wording must not imply a price change or refund.

## 2026-06-15 09:25 — Where should the prepaid multiplier apply?

### User prompt / intent
Determine which layer the 0.4 multiplier affects.

### AI action
Proposed applying the multiplier when computing the payable debit only; dashboard reads the stored payable.

### Files inspected
- docs/CHALLENGE_BILLING_SEMANTICS.md

### Commands run
- (analysis only)

### Assumptions
- Billing pipeline writes one ledger debit per usage record.

### Human corrections / decisions
- AI suggested the dashboard compute `officialCost * multiplier`. Human MODIFIED this to "read payableAmount from the ledger" to keep a single source of truth and avoid double application.

### Remaining risks
- Future downstream code could recompute payable; guard with a contract test.

## 2026-06-15 09:40 — Historical ledger treatment

### User prompt / intent
Decide whether past ledger entries should be rewritten.

### AI action
Recommended leaving history immutable; only the forward-looking label changes.

### Files inspected
- solutions/decision-log.md

### Commands run
- (analysis only)

### Assumptions
- Ledger is append-only.

### Human corrections / decisions
- Human confirmed no historical rewrite. Auditability and financial integrity outweigh cosmetic alignment. Decision recorded.

### Remaining risks
- None to money paths; display-only change.

## 2026-06-15 10:00 — Interrupted rollout decision

### User prompt / intent
Decide how to ship the urgent label fix while Phase 1 canary has public traffic.

### AI action
Read the rollout state and proposed freezing/draining Phase 1, building Phase 2 on stable image A, and ramping 0 → 5% → promote with image A as rollback.

### Files inspected
- ops/current-rollout-state.json
- ops/urgent-phase2-ticket.md

### Commands run
- (analysis only)

### Assumptions
- ALB weight shifting is the release control surface.

### Human corrections / decisions
- AI first proposed patching the public canary image in place to save time. Human REJECTED: a public-traffic canary must not be mutated in place (no clean rollback). Chose freeze/drain + stable-A base.

### Remaining risks
- Phase 1's dashboard-aggregation change remains unshipped; parked, to be re-canaried later.

## 2026-06-15 10:30 — Surgical refactor for ticket #4521

### User prompt / intent
Fix the data-overwrite bug where delayed refresh clobbers worker results, with the smallest safe change.

### AI action
Identified `analysis.service.ts` `delayedUpdate` overwriting via `updateJob`; proposed `DatabaseService.updateJobIfPending` with a status guard inside the atomic filter and one call-site change.

### Files inspected
- apps/legacy-app/src/analysis/analysis.service.ts
- apps/legacy-app/src/shared/database/database.service.ts

### Commands run
- (analysis only)

### Assumptions
- Mongo `updateOne` filter `{ jobId, status: 'PENDING' }` is atomic and safe.

### Human corrections / decisions
- AI offered to refactor the whole analysis flow (extract a job state machine). Human REJECTED the broad rewrite; scope locked to one helper + one call site per the refactor rules.

### Remaining risks
- Other call sites of `updateJob` are intentionally unchanged.

## 2026-06-15 11:00 — Test harness repair and characterization tests

### User prompt / intent
Prove the fix with red→green tests; baseline `pnpm --filter legacy-app test` failed with `jest: command not found`.

### AI action
Added jest/ts-jest/@types/jest devDeps and jest.config.js (dev-only), then wrote 4 characterization tests mocking DatabaseService and MessageQueueService.

### Files inspected
- apps/legacy-app/package.json
- apps/legacy-app/test/bug-repro.spec.ts

### Commands run
- pnpm install
- pnpm --filter legacy-app test

### Assumptions
- Tests must run without a live MongoDB (mock the DB).

### Human corrections / decisions
- Human required the RED run be preserved verbatim in test-evidence.md before the GREEN fix, not summarized. Captured accordingly.

### Remaining risks
- Test harness change is dev-only and does not affect runtime behavior.

## 2026-06-15 11:30 — Scale plan and final verification

### User prompt / intent
Plan 5M rows / 2h throughput and run the submission verifier.

### AI action
Computed ~695 rows/s target; proposed bounded in-process concurrency × horizontal worker replicas, idempotent upserts, token-bucket provider cap, DLQ. Ran the verifier.

### Files inspected
- solutions/scale-plan.md
- scripts/verify-submission.ts

### Commands run
- pnpm run verify:submission

### Assumptions
- Existing worker can be replicated horizontally without a rewrite.

### Human corrections / decisions
- AI relayed the CTO suggestion to rewrite the worker in Rust or migrate to Kubernetes. Human REJECTED both as out of scope for a 2-week, one-engineer effort; kept the existing Node worker.

### Remaining risks
- Provider rate limits are the real ceiling; mitigated with token-bucket cap and DLQ.

## 2026-06-15 11:43 — 熟悉 README 与仓库边界

### User prompt / intent
用户要求先熟悉当前 README.md，并强调后续必须明确 source of truth、release sequence，最终能运行 pnpm run verify:submission。

### AI action
读取仓库顶层结构、查找 AGENTS.md、阅读 README.md 前 260 行，并检索记忆库是否已有本项目相关上下文。

### Files inspected
- README.md
- AGENTS.md（通过目录列表确认存在，后续继续细读）
- /Users/keke/.codex/memories/MEMORY.md（仅检索是否存在相关命中）

### Commands run
- pwd
- ls -la
- find ".." -name "AGENTS.md" -print
- sed -n '1,260p' "README.md"
- rg -n "Senior Backend Challenge|-Senior-Backend-Challenge|source of truth|release sequence|verify:submission" "/Users/keke/.codex/memories/MEMORY.md" || true

### Assumptions
- 当前步骤只做 README 熟悉和边界识别，不开始实现。
- 本会话未暴露 Serena / Sequential-Thinking 工具，因此暂时降级使用 rg、sed、find 等本地工具。

### Human corrections / decisions
- 用户明确要求先熟悉 README.md。

### Remaining risks
- README.md 后续部分、具体 challenge 文档、现有 solutions 内容、测试脚本和 PR #9 尚未读取。

## 2026-06-15 11:44 — 细读 README 与提交约束

### User prompt / intent
用户要求先熟悉当前 README.md，重点关注 source of truth、release sequence 与最终 verify:submission。

### AI action
完整阅读 README.md、核对 AGENTS.md、查看 package.json 脚本、docs 与 solutions 文件列表，并检查当前 git 工作区状态。

### Files inspected
- AGENTS.md
- README.md
- package.json
- docs/CHALLENGE_BILLING_SEMANTICS.md（仅通过文件列表确认存在）
- docs/CHALLENGE_RELEASE_INTERRUPTION.md（仅通过文件列表确认存在）
- solutions/*（仅通过文件列表确认存在）

### Commands run
- sed -n '1,260p' "AGENTS.md"
- nl -ba "README.md" | sed -n '1,260p'
- nl -ba "README.md" | sed -n '261,520p'
- cat "package.json"
- find "docs" -maxdepth 2 -type f -print | sort
- find "solutions" -maxdepth 1 -type f -print | sort
- git status --short

### Assumptions
- README.md 是挑战总入口；具体 source-of-truth 与 release sequence 仍需从 docs、ops 和代码事实中校验。
- 当前工作区已有多处未提交修改，后续必须先区分现有改动来源，避免覆盖人工或既有 AI 工作。

### Human corrections / decisions
- 用户强调最终必须能运行 pnpm run verify:submission。

### Remaining risks
- 还未阅读 Part 2 / Part 3 详细文档、ops 当前发布状态、代码热路径和现有 solutions 内容。
- 还未参考 PR #9；后续需要用其作为参考而不是直接照抄。

## 2026-06-15 11:51 — Review current take-home submission changes

### User prompt / intent
User asked to review and check the current take-home submission summary, including source of truth, release sequence, tests, evidence, and whether to commit.

### AI action
Reviewed git diff scope, challenge docs, ops rollout state, solution files, PR #9 package/build reference, code changes, and fresh verification command output. Found that submission verifier passes, but build/root-test readiness is not fully green because workspace shared-types dependency and worker test harness are still unresolved.

### Files inspected
- apps/legacy-app/package.json
- apps/legacy-app/jest.config.js
- apps/legacy-app/src/analysis/analysis.service.ts
- apps/legacy-app/src/shared/database/database.service.ts
- apps/legacy-app/test/bug-repro.spec.ts
- apps/worker-service/package.json
- packages/shared-types/package.json
- packages/shared-types/tsconfig.json
- solutions/spec.md
- solutions/decision-log.md
- solutions/part1-billing-semantics.md
- solutions/part2-release-interruption.md
- solutions/release-command-log.md
- solutions/refactor-plan.md
- solutions/scale-plan.md
- solutions/test-evidence.md
- scripts/verify-submission.ts
- docs/CHALLENGE_BILLING_SEMANTICS.md
- docs/CHALLENGE_RELEASE_INTERRUPTION.md
- ops/current-rollout-state.json
- ops/urgent-phase2-ticket.md

### Commands run
- git status -sb
- git diff --stat
- git diff -- apps/legacy-app/src/analysis/analysis.service.ts apps/legacy-app/src/shared/database/database.service.ts apps/legacy-app/test/bug-repro.spec.ts apps/legacy-app/package.json apps/legacy-app/jest.config.js
- pnpm --filter legacy-app test
- pnpm --filter legacy-app build
- pnpm run verify:submission
- pnpm test
- pnpm --filter worker-service build
- pnpm -r build
- rg -n "@senior-challenge/shared-types|shared-types" "apps" "packages" "package.json" "pnpm-workspace.yaml"
- curl GitHub API for PR #9 metadata/files

### Assumptions
- Review is read-only except for this mandatory collaboration-log entry.
- Passing verify:submission is required but not sufficient evidence that code/build/test surface is clean.

### Human corrections / decisions
- User asked for review/checking, not implementation; no fixes or commits were made.

### Remaining risks
- P1: workspace packages importing @senior-challenge/shared-types do not declare it as a dependency, so legacy-app and worker-service builds fail.
- P1/P2: root pnpm test fails because worker-service declares jest but does not install/configure it.
- P2: solutions/test-evidence.md currently says verification is all green but does not disclose the fresh build/root-test failures observed during review.

## 2026-06-15 12:13 — 检查项目中是否仍存在 .omc

### User prompt / intent
用户询问“现在在查看下项目还有.omc吗”，意图是确认当前仓库中是否仍存在 `.omc` 文件或目录。

### AI action
按当前仓库根目录执行文件系统检查，确认顶层隐藏项和全项目路径中是否存在 `.omc`。

### Files inspected
- .
- solutions/ai-collaboration-log.md

### Commands run
- `pwd`
- `ls -la "." | sed -n '1,120p'`
- `find "." \( -path "./.git" -o -path "./node_modules" \) -prune -o \( -name ".omc" -o -path "*/.omc/*" \) -print`

### Assumptions
- “项目还有 .omc”按仓库工作区内的 `.omc` 文件或目录理解；`.git` 与 `node_modules` 不计入业务项目内容。

### Human corrections / decisions
- 尚无；等待用户确认是否需要进一步包含 `.git` 或 `node_modules` 做彻底扫描。

### Remaining risks
- 本次查找排除了 `.git` 与 `node_modules`；如果用户希望连依赖目录或 Git 内部对象也扫描，需要另行执行全量检查。

## 2026-06-15 12:13 — 复查 .omc 时包含 node_modules

### User prompt / intent
继续确认项目中是否仍存在 `.omc` 文件或目录。

### AI action
补充执行更宽范围查找：仅排除 `.git`，包含 `node_modules` 在内扫描 `.omc` 路径。

### Files inspected
- .
- solutions/ai-collaboration-log.md

### Commands run
- `find "." -path "./.git" -prune -o \( -name ".omc" -o -path "*/.omc/*" \) -print`

### Assumptions
- Git 内部对象不属于项目业务文件；依赖目录可以纳入复查范围以减少遗漏。

### Human corrections / decisions
- 尚无。

### Remaining risks
- 未扫描 `.git` 内部对象；按本问题语义通常无需检查 Git 内部存储。
