# Part 4: Audience 数据缺失 — 调用链路追踪报告

> ⚡ 请在动手修复之前完成此报告。

## 1. 调用链路追踪

追踪一个请求从发起到结果返回的完整路径。对比 **成功请求** 和 **失败请求** 在每一层的数据差异。

### 成功请求（例: mediaId=67890）

| 层级 | 文件 : 行号 | 输入数据 | 输出数据 |
|------|-----------|---------|---------|
| Runner | run-audience-test.ts : L? | | |
| AudienceService | audience.service.ts : L? | | |
| FacadeService | facade-audience.service.ts : L? | | |
| MockAPI | mock-audience-api.ts : L? | | |

### 失败请求（mediaId=12345）

| 层级 | 文件 : 行号 | 输入数据 | 输出数据 |
|------|-----------|---------|---------|
| Runner | run-audience-test.ts : L? | | |
| AudienceService | audience.service.ts : L? | | |
| FacadeService | facade-audience.service.ts : L? | | |
| MockAPI | mock-audience-api.ts : L? | | |

## 2. 数据结构差异分析

请对比成功和失败请求中，**第三方 API 返回的原始数据结构**有什么不同：

```json
// 成功请求的 API 响应结构:


// 失败请求的 API 响应结构:

```

**差异在哪一行代码导致了 null？**

```
文件:
行号:
代码:
原因:
```

## 3. 修复方案

<!-- 你如何修复这个问题？ -->

## 4. 扩展性设计（进阶）

如果要增加 `youtube`, `twitter`, `linkedin` 三个新平台：

### 当前代码结构的问题

<!-- 如果直接加，会出什么问题？ -->

### 你的设计方案

<!-- 你用什么设计来降低耦合？ -->

```typescript
// 核心设计代码
```

## 5. 验收结果

```bash
# 请粘贴修复后 pnpm simulate:audience-bug 的输出
```
