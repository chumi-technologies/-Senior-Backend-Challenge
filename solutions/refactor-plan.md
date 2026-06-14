# Surgical Refactor Plan

> Complete before touching messy hot-path code.

## 1. Target

- File: `apps/legacy-app/src/analysis/analysis.service.ts`
- Function / class: `AnalysisService.delayedUpdate()`
- Why this is in scope: 这个延迟写库可能覆盖 worker 已完成的结果。

## 2. Current responsibility leak

`AnalysisService` 同时创建 job、发队列、生成 quick demographics、延迟写库，职责混在一起。

## 3. Characterization test

- Existing behavior to lock: 创建 job 后保存 `PENDING`，并发布 `AnalysisRequested`。
- Test file: `apps/legacy-app/test/bug-repro.spec.ts`
- Expected failure mode if behavior changes accidentally:

## 4. Extraction boundary

- Extracted helper / function: 判断 delayed update 是否还能写。
- Inputs: 当前 job status。
- Outputs: allow / skip。
- Side effects: 无。
- Why this is the smallest safe boundary: 只挡覆盖问题，不改队列、worker、Mongo schema。

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Rewrite service | 范围太大 |
| Replace queue | 跑题 |
| Rebuild worker | 风险太高 |

## 6. Verification

- Tests run:
- Command output:
- Remaining risk: 还没写测试，也没改代码。
