# Part 4: Audience Data Integration — 详细说明

## 📋 背景

你的团队从第三方 API 集成 influencer 的受众数据（audience demographics）。这个集成使用 **Playwright** 来处理需要浏览器环境的 API 调用。

**系统架构**：
```
AudienceService (业务逻辑层)
    ↓
FacadeAudienceService (API 包装层 + Playwright)
    ↓
Third-Party Audience API (Mock Server)
```

## 🛠️ Setup (首次运行)

本挑战依赖 **Playwright**，首次运行需要安装浏览器：

```bash
cd apps/worker-service
npx playwright install chromium
cd ../..
```

## 🎯 任务流程

### 1. 复现问题

```bash
pnpm simulate:audience-bug
```

查看输出，确认哪些请求成功，哪些失败。

### 2. 调用链路追踪

**你的核心任务**：追踪数据在整个调用链中的流转，找出它在哪一层"丢失"了。

需要阅读的文件（按调用顺序）：
1. `apps/worker-service/src/audience-integration/run-audience-test.ts`
2. `apps/worker-service/src/audience-integration/audience.service.ts`
3. `apps/worker-service/src/audience-integration/facade-audience.service.ts`
4. `apps/worker-service/src/audience-integration/mock-audience-api.ts`

### 3. 修复并验证

```bash
pnpm simulate:audience-bug
# 预期: Errors: 0
```

### 4. 扩展性设计（进阶）

PM 要求下周增加 `youtube`, `twitter`, `linkedin` 三个新平台。请在代码中体现你的扩展性设计。

## 📊 评分标准

| 要求 | 分数 |
|------|------|
| 调用链路追踪精度（文件、行号、数据差异） | 30分 |
| 修复正确性 | 30分 |
| 扩展性设计 | 20分 |
| 代码质量 | 20分 |
