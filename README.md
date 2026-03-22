# 🔧 Senior Backend Engineer Challenge

> **重要说明**: 本项目是一个高级后端工程师技术面试挑战。与传统的"从零搭建"不同，本挑战模拟的是一个**真实的遗留系统修复场景**，用于评估候选人对复杂分布式系统的调试、重构和架构治理能力。

## 📋 项目背景

你加入了一个创业公司，接手了一个"能跑但问题很多"的数据处理系统。该系统负责接收用户数据分析请求，调用第三方 AI 服务进行处理，并返回结果。

**你的前任留下了以下问题：**

1. 🔥 **数据不一致**：用户反馈"刚刚看到的分析结果，刷新后又变了"
2. 🐛 **调试困难**：每次修改代码都要部署到云端才能测试，反馈周期 5 分钟+
3. 💥 **莫名其妙的崩溃**：第三方 API 返回格式偶尔变化，导致整个批处理任务失败
4. 📉 **无法排查**：日志里只有 `Error happened`，无法定位是哪条数据出问题

## 🏗️ 系统架构

```
┌─────────────────┐         SQS Queue          ┌─────────────────┐
│   LegacyApp     │ ─────────────────────────► │  WorkerService  │
│   (REST API)    │    AnalysisRequested       │  (SQS Consumer) │
│   Port: 3000    │                            │                 │
└────────┬────────┘                            └────────┬────────┘
         │                                              │
         │  ⚠️ WRITES                                   │  ⚠️ ALSO WRITES
         │                                              │
         ▼                                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         MongoDB                                  │
│                     (analysis_results)                           │
│                                                                  │
│   ⚠️ 问题：两个服务都在写同一条记录，存在竞态条件                    │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

### 前置要求

1. **Node.js 20+** - 使用 nvm: `nvm use`
2. **Docker** - 用于运行 MongoDB
3. **pnpm** - 包管理器

### 安装依赖

```bash
pnpm install
```

### 启动本地开发环境

```bash
# 终端 1: 启动 MongoDB
docker-compose up -d

# 终端 2: 启动 LegacyApp (REST API)
pnpm run start:legacy

# 终端 3: 启动 WorkerService (SQS Consumer - 本地模拟)
pnpm run start:worker
```

### 测试 API

```bash
# 创建分析任务
curl -X POST http://localhost:3000/api/analysis \
  -H 'Content-Type: application/json' \
  -d '{
    "userId": "user-123",
    "dataUrl": "https://example.com/data.json"
  }'

# 查询分析结果
curl http://localhost:3000/api/analysis/{jobId}
```

---

# 📝 面试任务

## 任务概述

你需要在 **3-4 小时** 内完成以下任务。请在 `solutions/` 目录下记录你的分析和解决方案。

> **🤖 提示：** 本挑战高度契合现代 AI 工程师的工作模式（AI Vibe Coding）。我们**强烈建议**你使用 Cursor, ChatGPT, Cline 等 AI 工具辅助完成。
> **⚠️ 必须遵守：如果你使用了 AI，请务必导出或复制你与 AI 的完整对话记录，并以 `solutions/ai-chat-log.md`（或类似格式）连同代码一起提交。我们将通过这些记录评估你的 Prompt 逻辑、系统分析能力以及和 AI 的协作编码能力。**

---

## 第一部分：工具链建设 - "Capture & Replay" (约30分钟)

### 问题描述

目前团队的调试流程非常痛苦：
1. 发现线上 Bug
2. 修改代码
3. 部署到云端（等待 5 分钟）
4. 触发任务，等待执行
5. 查看 CloudWatch 日志
6. 发现猜错了，回到步骤 2

**你的任务是建立一个 "Payload Capture & Replay" 机制，让开发者可以在本地秒级复现问题。**

### 要求

1. **编写 Middleware** (`apps/worker-service/src/middleware/capture.middleware.ts`)
   - 当环境变量 `CAPTURE_MODE=true` 时，将每条 SQS 消息的完整 Payload 保存到 `debug-payloads/` 目录

2. **编写 Replay 脚本** (`scripts/replay-event.ts`)
   - 从 `debug-payloads/` 读取指定的 Payload 文件
   - 直接调用 Worker 的 Handler 函数（绕过 SQS）
   - 支持命令行参数：`pnpm run replay -- --file=job-xxx.json`

### 验收标准

```bash
# 1. 开启捕获模式，触发一个任务
CAPTURE_MODE=true pnpm run start:worker

# 2. 应该在 debug-payloads/ 下生成 JSON 文件

# 3. 使用 replay 脚本本地调试
pnpm run replay -- --file=debug-payloads/job-xxx.json
# 应该能看到 Handler 的完整执行日志，无需启动 SQS
```

---

## 第二部分：架构治理 - "Single Source of Truth" (约45分钟)

### 问题描述

查看 `apps/legacy-app/src/analysis/analysis.service.ts` 和 `apps/worker-service/src/processors/analysis.processor.ts`。

你会发现：
- **LegacyApp** 在收到请求后，会进行**初步计算**并写入数据库
- **WorkerService** 在处理任务时，会进行**完整计算**并**也写入数据库**
- 两者写入的是**同一条记录的同一个字段**

**这导致了竞态条件**：
- 如果 WorkerService 先完成，LegacyApp 的延迟写入会覆盖正确的结果
- 用户看到的数据会"闪烁"

### 要求

1. **分析问题根因**
   - 在 `solutions/part2-analysis.md` 中解释这个 Bug 的成因

2. **重构代码**
   - 确定**唯一的数据计算和写入点**
   - 修改 LegacyApp 使其**只负责任务分发**，不再进行计算和写入
   - 修改 WorkerService 使其成为**唯一的真相来源 (Single Source of Truth)**
   - 处理好状态流转：`PENDING` → `PROCESSING` → `COMPLETED`

3. **解决竞态条件**
   - 使用乐观锁 (Optimistic Locking) 或版本号防止脏写

### 验收标准

- 创建任务后，无论刷新多少次，数据都不会"闪烁"
- `LegacyApp` 中不再有 `calculateDemographics` 相关逻辑

---

## 第三部分：可观测性与容错 - "Dirty Data Defense" (约30分钟)

### 问题描述

查看 `debug-payloads/chaos-data-samples.json`，这是从生产环境捕获的真实第三方 API 响应样本。

你会发现数据非常"脏"：
- 有些 `age` 是数字 `25`，有些是字符串 `"25+"`，有些是 `null`
- 有些记录缺少必要字段
- 有些 `email` 格式不合法

**目前的代码遇到这些数据会直接 Crash，导致整个批处理失败。**

### 要求

1. **引入 Runtime Validation**
   - 使用 **Zod** 或 **class-validator** 在 Worker 中校验第三方数据
   - 不合法的数据应该**被记录并跳过**，而不是 Crash 整个流程

2. **改进日志**
   - 替换所有 `console.log` / `console.error`
   - 使用结构化日志：`{ event: 'ValidationFailed', jobId, field: 'age', rawValue: '25+' }`
   - 确保每条日志都包含 `traceId`（从 LegacyApp 透传）

3. **实现 Dead Letter 逻辑**
   - 处理失败的记录应该被保存到 `failed-records/` 目录
   - 记录失败原因和原始 Payload

### 验收标准

```bash
# 处理 chaos-data-samples.json 中的数据
pnpm run process:chaos

# 应该输出类似：
# ✅ Processed: 95 records
# ⚠️ Skipped (validation failed): 5 records
# 📁 Failed records saved to: failed-records/batch-xxx.json
```

---

## 第四部分：第三方集成调试 - "Audience 数据未返回" (约40分钟)

### 问题描述

你的团队从第三方 API 集成 influencer 的受众数据（audience demographics）。这个集成使用 **Playwright** 来处理需要浏览器环境的 API 调用。

**系统架构**：
```
AudienceService (业务逻辑层)
    ↓
FacadeAudienceService (API 包装层 + Playwright)
    ↓
Third-Party Audience API
```

**Bug 现象**：
- ✅ 大部分 influencers 的 audience 数据正常返回
- ❌ **特定的 `mediaId`（如 `12345`）总是返回 `null`**
- 📊 日志显示：`[FacadeService] ⚠️ Audience data is NULL - why??`
- 🤔 但第三方 API 确实返回了 200 OK 和数据

这个 bug **在生产环境隐藏了数月**才被发现，因为只影响 ~5% 的数据。

### 要求

1. **复现 Bug**
   ```bash
   pnpm simulate:audience-bug
   ```
   你应该看到某个 `mediaId` 返回 null

2. **定位问题根因**
   - 追踪完整调用链：`run-audience-test.ts` → `audience.service.ts` → `facade-audience.service.ts` → `mock-audience-api.ts`
   - 查看日志中的 `Raw response` 输出
   - 对比成功和失败的响应，找出数据结构差异

3. **修复代码**
   - 使 `facade-audience.service.ts` 能处理**两种不同的 API 响应格式**（新格式 vs 老格式）
   - 添加适当的错误处理和日志
   - 考虑使用 TypeScript 类型保护

4. **验证修复**
   - 所有测试数据都应成功返回（`Errors: 0`）

### 学习目标

这个挑战模拟真实的第三方集成问题：
- **数据格式不稳定**：第三方 API 可能返回不同版本的响应
- **调试链路长**：需要追踪多层嵌套调用
- **Playwright 实战**：理解浏览器上下文管理
- **防御性编程**：写能应对"脏数据"的健壮代码

详细说明请查看: [`docs/CHALLENGE_AUDIENCE_BUG.md`](docs/CHALLENGE_AUDIENCE_BUG.md)

---

## 第五部分：系统设计与权衡 (开放性问题)


> **场景背景**：
> 恭喜，你的修复上线后系统稳定了。但现在销售团队签下了一个 Enterprise 大客户。
> 
> **新需求**：
> 客户每周一早上 9:00 会上传一个 **10GB 的 CSV 文件**（约 500 万行记录）到 S3，要求在 **2 小时内** 完成所有分析并生成报告。
> 
> **现有限制**：
> 1. 目前的 Worker 是单实例轮询，处理速度约为 10 条/秒。
> 2. 团队目前只有 **你 1 个后端人力**（其他人都在赶前端 Feature）。
> 3. 只有 **2 周** 时间上线。
> 
> **CTO 的提议**：
> CTO 听说 Rust 很快，建议你用 Rust 重写 Worker，或者上 Kubernetes 做自动扩缩容。
> 
> **你的任务**：
> 在 `solutions/part4-tradeoffs.md` 中回答以下问题：
> 1. **架构方案**：你会如何修改架构来满足 500万条/2小时 的吞吐量？请画出架构简图。
> 2. **技术选型**：你会接受 CTO 用 Rust 重写的建议吗？为什么？如果拒绝，你的替代方案是什么？
> 3. **妥协与牺牲**：在只有 2 周和 1 个人的情况下，为了达成目标，你会主动牺牲掉哪些"最佳实践"或功能？
> 4. **调试灾难预案**：当 500 万条数据中有 1% 失败（5万条错误）时，你的日志系统会爆炸。你如何设计监控和报错机制，既能让研发排查问题，又不至于被报警淹没？

---

## 📊 评分标准

| 维度 | 分数 | 评分标准 |
|------|------|----------|
| Part 1: Capture & Replay 工具 | 20分 | 脚本可用，能在本地秒级复现 |
| Part 2: 架构治理 | 25分 | 正确识别双写问题，重构后无竞态 |
| Part 3: 数据容错 | 20分 | 脏数据不导致 Crash，有结构化日志 |
| Part 4: Audience Bug 调试 | 20分 | 正确定位并修复数据格式兼容问题 |
| 代码质量 | 15分 | TypeScript 规范、清晰的注释、合理的抽象 |

## 🎯 加分项

- 使用 **Zod** 而不是 try-catch 进行类型校验
- 实现 **Trace ID** 全链路透传
- 添加单元测试覆盖核心逻辑
- 在 `solutions/` 中提供清晰的架构图和解释

---

## 📁 项目结构

```
senior-backend-challenge/
├── apps/
│   ├── legacy-app/              # REST API 服务 (模拟 chumi_server)
│   │   └── src/
│   │       ├── analysis/        # 分析模块 (⚠️ 有问题的代码)
│   │       └── shared/          # 共享服务
│   └── worker-service/          # 消息处理 Worker (模拟 collaboration-api)
│       └── src/
│           ├── processors/      # 消息处理器 (⚠️ 有问题的代码)
│           └── middleware/      # 中间件 (待实现)
├── packages/
│   └── shared-types/            # 共享类型定义
├── scripts/
│   ├── replay-event.ts          # 待实现: Replay 调试脚本
│   └── process-chaos.ts         # 处理脏数据的脚本
├── debug-payloads/              # Payload 捕获目录
│   └── chaos-data-samples.json  # 脏数据样本
├── failed-records/              # 失败记录目录
├── solutions/                   # 你的解决方案文档
│   ├── ai-chat-log.md           # ⚠️ 必需：你与 AI 工具的完整对话记录
│   ├── part1-replay-tool.md
│   ├── part2-analysis.md
│   └── part3-observability.md
├── docker-compose.yml           # MongoDB 配置
└── package.json                 # Monorepo 根配置
```

---

## ❓ 常见问题

**Q: 可以使用 AI 工具吗？**
A: **非常鼓励！** 但请注意，这是一个考察你如何与 AI 协作（AI Vibe Coding）的测试。我们更关注你的 **Prompt 设计、Bug 排查思路以及架构决策**，而不是单纯的代码生成速度。
**⚠️ 强制要求：如果你使用了 AI 工具（强烈建议使用），请务必将完整的对话记录（包括你的提示词和 AI 的回复）导出或复制，并保存为 `solutions/ai-chat-log.md` 与代码一并提交。如果你不提供完整的 AI 对话记录，我们将无法评估你真正的工程排查能力。**

**Q: 时间不够怎么办？**
A: 优先完成第一部分和第二部分。第三部分可以简化为口头描述方案。

**Q: 需要真的连接 AWS 吗？**
A: 不需要。本项目使用本地 MongoDB 和模拟的消息队列，所有测试都可以在本地完成。

---

祝你好运！ 🚀
