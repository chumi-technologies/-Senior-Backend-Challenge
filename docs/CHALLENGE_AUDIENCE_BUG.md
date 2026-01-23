# 🐛 Challenge Part 5: Audience Data "No Return" Bug

## 📋 Context

你的团队从第三方 API 集成 influencer 的受众数据（audience demographics）。这个集成使用 **Playwright** 来处理需要浏览器环境的 API 调用（类似真实的 Upfluence/HypeAuditor 集成）。

**系统架构**：
```
AudienceService (业务逻辑层)
    ↓
FacadeAudienceService (API 包装层 + Playwright)
    ↓
Third-Party Audience API (Mock Server)
```

## 🚨 The Problem

在生产环境中，你的同事发现某些 influencers 的 audience 数据**总是返回 null**，但其他人的数据正常。

**症状**：
- ✅ 大部分 `mediaId` 数据正常返回
- ❌ 特定的 `mediaId`（如 `12345`）返回 `null`
- 📊 日志显示：`[FacadeService] ⚠️ Audience data is NULL - why??`

**更诡异的是**：
- 第三方 API 确实返回了数据（状态是 200 OK）
- 但是我们的代码认为数据是空的

## 🎯 Your Task

### 1. **复现 Bug** (5-10分钟)

运行测试脚本：
```bash
pnpm simulate:audience-bug
```

你应该看到：
```
🐛 Failed Requests:
   1. Platform: instagram, MediaId: 12345

💡 Hint: Check the logs above to see where the data became null
```

### 2. **定位问题** (15-20分钟)

调查以下文件链路，找到数据在哪里"丢失"：

1. `apps/worker-service/src/audience-integration/run-audience-test.ts` - 入口点
2. `apps/worker-service/src/audience-integration/audience.service.ts` - 业务逻辑
3. `apps/worker-service/src/audience-integration/facade-audience.service.ts` - **🔥 Bug 可能在这里**
4. `apps/worker-service/src/audience-integration/mock-audience-api.ts` - 第三方 API 模拟

**提示**：
- 查看日志中的 `[FacadeService] Raw response:` 输出
- 对比 `mediaId=12345` 和其他正常的响应，数据结构有什么不同？
- 为什么 `facade-audience.service.ts` 的数据提取逻辑对某些响应无效？

### 3. **修复 Bug** (10-15分钟)

修改代码使其能够处理**两种不同的 API 响应格式**：

**新格式** (大部分情况):
```json
{
  "status": "success",
  "data": {
    "audience": {
      "gender": [...]
    }
  }
}
```

**老格式** (legacy, 少数情况):
```json
{
  "status": "success",
  "audience_data": {
    "demographics": {
      "gender": [...]
    }
  }
}
```

**要求**：
- 修改 `facade-audience.service.ts` 以支持两种格式
- 添加适当的错误处理和日志
- 确保所有测试数据都能成功返回

### 4. **验证修复** (5分钟)

再次运行：
```bash
pnpm simulate:audience-bug
```

预期结果：
```
✅ Success: 5/4.5 requests
❌ Errors: 0
```

## 📊 评分标准

| 要求 | 分数 |
|------|------|
| 正确识别问题根因（数据格式不兼容） | 30分 |
| 修复代码以支持两种格式 | 40分 |
| 添加合理的日志和错误处理 | 20分 |
| 代码质量（TypeScript 类型、注释） | 10分 |

## 🎓 学习目标

这个挑战模拟真实的第三方集成问题：

1. **数据格式不稳定**：第三方 API 可能返回不同版本的响应格式
2. **调试链路长**：需要追踪多层调用才能找到问题
3. **Playwright 使用**：理解浏览器上下文管理和请求拦截
4. **防御性编程**：写能应对"脏数据"的健壮代码

## 🔧 Advanced (可选加分)

如果你提前完成，考虑：

1. **性能优化**：当前每个请求都创建新的 browser instance，如何共享？
2. **Auth Pool 改进**：`mock-auth-pool.ts` 有并发竞争问题，如何修复？
3. **类型安全**：为两种响应格式定义 TypeScript types
4. **单元测试**：为数据提取逻辑写测试

---

**提示**：真实项目中，类似的 bug 可能隐藏数月才被发现，因为只影响小部分数据。学会快速定位这类问题是 Senior 工程师的重要技能。
