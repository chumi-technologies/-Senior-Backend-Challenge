# 🔧 Senior Backend Engineer Challenge

> **重要说明**: 本项目模拟真实的遗留系统修复场景。你将接手一个"能跑但问题很多"的数据处理系统，通过排查、修复、重构来证明你的系统级工程能力。

## 🤖 关于 AI 工具的使用

**本挑战要求你使用 AI 工具（Cursor, Claude, ChatGPT 等）辅助完成。**

我们不考察"你是否能脱离 AI 手写代码"。**我们考察的是你和 AI 组成的 team 如何解决复杂工程问题。**

具体来说，我们通过你的 AI 对话记录评估以下三项核心能力：

| 核心能力 | 具体表现 |
|----------|---------|
| **复杂系统切分** | 你能否将多服务交互拆解为独立的数据流片段，即使面对"魔法般"的 AI 输出，也能找到逻辑线索 |
| **领域语义直觉** | 你能否快速从字段名推断业务含义？看到 `confidence: 0.3` 和 `confidence: 0.85` 时，你对"数据可信度"的理解是否立即浮现？ |
| **AI 协作深度** | 你向 AI 提出的问题质量——是在做"系统认知"还是在做"搜索引擎式复制粘贴"？ |

> ⚠️ **强制要求**：请将完整的 AI 对话记录保存为 `solutions/ai-collaboration-log.md` 并随代码一起提交。**对话记录是评分的核心依据之一**——如果缺失，我们将无法评估你真正的工程思维。

---


## 🧾 AI 协作记录与跨 IDE Agent 规则

本仓库包含 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/challenge.mdc`, `.windsurfrules`。无论你使用 Codex、Claude Code、Cursor、Gemini、Windsurf 或其他 AI IDE，都应遵守这些规则。

核心要求：

1. AI 每完成一个有意义步骤，都要追加记录到 `solutions/ai-collaboration-log.md`。
2. 在修改 billing、usage、routing、failover、canary、release 或 customer-facing contract 前，必须先在 `solutions/decision-log.md` 定义语义和 source of truth。
3. 涉及上线、canary、stable、rollback 的动作必须记录到 `solutions/release-command-log.md`。
4. 最终提交前运行：

```bash
pnpm run verify:submission
```

我们不会因为你使用 AI 扣分；我们会重点评估你是否能发现 AI 对业务语义和上线状态的误判，并主动纠正它。

## 📋 项目背景

你加入了一个做 influencer marketing 数据分析的创业公司。系统负责接收品牌方的数据分析请求，通过第三方 AI/数据服务对 influencer 受众进行画像分析，并将报告返回给用户。

你的前任工程师已经离职了。以下是你上班第一天的情况。

## 🏗️ 系统架构

```
┌─────────────────┐      Message Queue (SQS)      ┌─────────────────┐
│   LegacyApp     │ ─────────────────────────────► │  WorkerService  │
│   (REST API)    │    AnalysisRequested          │  (SQS Consumer) │
│   Port: 3000    │                               │                 │
└────────┬────────┘                               └────────┬────────┘
         │                                                 │
         │  Read / Write                                   │  Read / Write
         │                                                 │
         ▼                                                 ▼
┌───────────────────────────────────────────────────────────────────┐
│                         MongoDB                                    │
│                     (analysis_jobs collection)                     │
└───────────────────────────────────────────────────────────────────┘
```

**核心数据模型 `AnalysisJob`**：
```typescript
{
  jobId: string;          // 唯一任务标识
  userId: string;         // 发起分析的用户
  dataUrl: string;        // 待分析的数据源 URL
  status: AnalysisStatus; // 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  demographics?: {        // 受众画像分析结果
    ageRange?: string;    //   年龄段
    gender?: string;      //   性别
    location?: string;    //   地区
    confidence?: number;  //   结果置信度 (0~1)
  };
  createdAt: string;
  updatedAt: string;
}
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

你需要在 **3-4 小时** 内完成以下任务。

## 🔑 核心交付物：系统认知报告

**在动手写代码之前**，每个任务都需要你先提交一份"系统认知报告"到 `solutions/` 目录。报告需要包含：

1. **数据流向图**：画出问题场景中数据从产生到最终状态的完整流转路径
2. **字段语义标注**：说明关键字段在业务场景中意味着什么
3. **根因假设**：基于你的分析，在写任何代码之前提出根因假设

> ⚡ **这不是走过场。系统认知报告的质量在总评分中权重最高。** 一份好的报告应该在你还没写任何代码之前，就已经精确定位到了问题的本质。

---

## Part 1: 工具链建设 — Capture & Replay (约30分钟)

### 背景

团队目前的调试流程非常痛苦：每次修改代码都要部署到云端才能测试，反馈周期 5 分钟+。

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
# 1. 开启捕获模式
CAPTURE_MODE=true pnpm run start:worker

# 2. debug-payloads/ 下应生成 JSON 文件

# 3. 使用 replay 本地调试
pnpm run replay -- --file=debug-payloads/job-xxx.json
# 应看到 Handler 的完整执行日志，无需启动队列
```

---

## Part 2: 诊断与修复 — 客服工单 #4521 (约45分钟)

### 📨 以下是你上班第一天收到的 Slack 消息

**#customer-support 频道：**
```
@channel 用户再次反馈报告数据异常

工单 #4521
用户 ID: user-8827
时间: 2026-04-10 14:32 UTC

现象：
用户在 14:32:01 查看了分析报告（jobId: a3f8e-...），页面显示：
  gender: female, location: US, confidence: 0.85

14:32:03 刷新页面后，数据变成了：
  gender: male, location: CA, confidence: 0.3

用户非常困惑，质疑我们数据的可信度。
这是本周第三个类似投诉了。
```

**#engineering 频道：**
```
@team 关于数据跳变的问题——这个月已经有 12 个工单了。
每次现象都一样：刚生成的报告过几秒就变回一个低质量版本。
有人能看看吗？日志里只有 "Error happened"，完全没法定位。
```

### 要求

1. **系统认知报告** (`solutions/part2-analysis.md`)
   - 追踪 `AnalysisJob` 从创建到最终状态的完整数据生命周期
   - 标注哪些服务、在什么时间点、对同一条记录做了什么操作
   - 解释为什么用户先看到 `confidence: 0.85` 后看到 `confidence: 0.3`——精确到代码行和时间窗口

2. **TDD 验证** (`apps/legacy-app/test/bug-repro.spec.ts`)
   - 先写测试证明 Bug 存在（Red）
   - 再修复代码让测试通过（Green）

3. **代码修复**
   - 修复根因，确保 `PENDING → PROCESSING → COMPLETED` 的状态流转稳固
   - 无论并发时序如何乱序，数据都不再跳变

### 验收标准

- 系统认知报告中有精确到毫秒的数据生命周期时序图
- TDD 测试先红后绿
- 修复后数据一致性可证明

---

## Part 3: 生产事故 — 凌晨三点的电话 (约30分钟)

### 📨 事故报告

```
事故时间: 2026-04-09 03:14 UTC
影响范围: Worker 批处理服务全部崩溃，排队中的分析任务积压
恢复方式: 手动重启 Worker 后恢复，但相同任务重新触发时再次崩溃

初步排查:
  - Worker 日志最后一条: "Error happened"（无其他上下文）
  - Crash 似乎与某些第三方 API 响应数据有关
  - 已将事发时段捕获到的第三方 API 原始响应保存在 debug-payloads/chaos-data-samples.json
```

查看 `debug-payloads/chaos-data-samples.json`——这是从第三方 API 捕获的真实响应。你需要理解每条记录中的每个字段在 influencer marketing 领域的业务含义，才能判断"什么样的数据是脏的"以及"为什么它会导致 Crash"。

### 要求

1. **数据质量分析** (`solutions/part3-observability.md`)
   - 逐条审查 `chaos-data-samples.json`
   - 对每条记录标注: 合法 / 不合法，以及判断依据
   - 你的判断依据应该体现你对 influencer demographics 数据的业务理解

2. **Runtime Validation**
   - 在 Worker 中引入运行时数据校验
   - 不合法的数据应被记录并跳过，不应 Crash 整个流程

3. **结构化日志**
   - 替换所有 `console.log('Error happened')` 式的日志
   - 每条日志包含: `jobId`, `traceId`, 事件类型, 上下文信息

4. **Dead Letter 逻辑**
   - 失败记录保存到 `failed-records/`，包含失败原因和原始数据

### 验收标准

```bash
pnpm run process:chaos

# ✅ Processed: X records
# ⚠️ Skipped (validation failed): Y records
# 📁 Failed records saved to: failed-records/batch-xxx.json
```

---

## Part 4: Audience 数据集成 — 5% 数据缺失 (约40分钟)

### 📨 数据分析团队的报告

```
@engineering 我们在做月度数据质量审计时发现一个问题：

受众画像 (audience demographics) 数据有大约 5% 的缺失率。

具体表现:
- 绝大部分 influencer 的受众数据正常采集
- 但某些特定的 mediaId 总是返回空值
- 我们已经确认第三方 API 对这些 mediaId 返回了 200 OK
- 但我们系统里存的是 null

受影响的 mediaId 样本: 12345, 54321, ...
这个问题已经存在好几个月了，因为只影响少量数据一直没人注意到。
```

### 要求

1. **复现 Bug**
   ```bash
   pnpm simulate:audience-bug
   ```

2. **调用链路追踪** (`solutions/part4-audience-trace.md`)
   - 追踪完整调用链: `run-audience-test.ts` → `audience.service.ts` → `facade-audience.service.ts` → `mock-audience-api.ts`
   - 对比成功请求和失败请求在每一层的数据差异
   - 精确标注数据在哪一层、哪一行代码"丢失"的

3. **修复与验证**
   - 修复数据丢失问题
   - 验证所有测试 mediaId 都能成功返回 (`Errors: 0`)

4. **扩展性设计**（进阶）
   - PM 通知你下周要增加 `youtube`, `twitter`, `linkedin` 三个新平台的受众抓取
   - 以当前代码结构，如何避免沦为 `if/else` 堆积？请在代码中体现你的设计思路

### 验收标准

- 调用链路文档精确到代码行号和数据结构差异
- 所有测试 mediaId 数据成功返回 (`Errors: 0`)
- 新平台接入无需修改核心逻辑

---

## Part 5: 系统设计与权衡 (开放性问题)

> **场景背景**：
> 你的修复上线后系统稳定了。但销售团队签下了一个 Enterprise 大客户。
>
> **新需求**：
> 客户每周一早上 9:00 会上传一个 **10GB 的 CSV 文件**（约 500 万行记录）到 S3，要求在 **2 小时内** 完成所有分析并生成报告。
>
> **现有限制**：
> 1. 目前的 Worker 是单实例轮询，处理速度约为 10 条/秒。
> 2. 团队目前只有 **你 1 个后端人力**。
> 3. 只有 **2 周** 时间上线。
>
> **CTO 的提议**：
> CTO 听说 Rust 很快，建议你用 Rust 重写 Worker，或者上 Kubernetes 做自动扩缩容。
>
> 在 `solutions/part5-tradeoffs.md` 中回答：
> 1. **架构方案**：你会如何修改架构来满足 500万条/2小时 的吞吐量？请画出架构图。
> 2. **技术选型**：你会接受 CTO 用 Rust 重写的建议吗？为什么？替代方案？
> 3. **妥协与牺牲**：2 周 1 个人，你会主动放弃哪些"最佳实践"？
> 4. **调试灾难预案**：500 万条中 1% 失败（5万条错误），如何设计监控让研发能排查而不被报警淹没？


---

## Part 6: The “Balance” Incident — 语义调试 (约45分钟)

> 详细说明见 `docs/CHALLENGE_BILLING_SEMANTICS.md`。

### 背景

财务和客服同时报告一个看似矛盾的问题：Acme Team 购买了 `0.4` 倍率的 team prepaid package。Dashboard 显示 `Total usage cost: $100.00`，但团队钱包只扣了 `$40.00`。

这不是一道简单的“让两个数字相等”的题。系统里存在多种 `balance`、多种 `cost`、多种 `usage`。如果你或 AI 没有先澄清语义，很容易改错账本或生产第二套财务逻辑。

### 要求

1. 先更新 `solutions/decision-log.md`，定义：customer balance、provider balance、load balance、official cost、actual/payable cost、raw usage event、ledger entry。
2. 完成 `solutions/part6-billing-semantics.md`。
3. 再决定是否需要代码修改。
4. 验证不能破坏：ledger debit、official usage report、provider balance、load-balancing weight、retry idempotency。

### 红线

- 不允许为了让 dashboard 数字一致而直接修改扣费逻辑。
- 不允许新增第二套 billing source of truth。
- 不允许把 `balance` 全局替换成同一种含义。

---

## Part 7: Interrupted Rollout — Urgent Fix Without Customer Impact (约45分钟)

> 详细说明见 `docs/CHALLENGE_RELEASE_INTERRUPTION.md`。

### 背景

Phase 1 已经上线到 public canary 1%，但尚未 promoted。此时 Phase 2 urgent ticket 到来，要求 60 分钟内修复 customer-facing cost display，同时保持客户无感和高可用。

当前状态在：

```bash
ops/current-rollout-state.json
ops/urgent-phase2-ticket.md
```

### 要求

1. 先记录当前 stable/canary/image/ALB weight 到 `solutions/release-command-log.md`。
2. 判断是否可以直接 update canary service。
3. 判断 urgent patch 应该基于 stable image A 还是 Phase 1 canary image B。
4. 写出客户无感的 release sequence。
5. 完成 `solutions/part7-release-interruption.md`。
6. 证明 ledger semantics 没变、客户不会看到两套账本/两套 response shape。

### 红线

- Public canary traffic 非 0 时，不允许直接热更新 canary task。
- 不允许没有 dependency analysis 就把 Phase 1 和 Phase 2 合成一个版本。
- 不允许跳过 ALB weight 检查。
- 不允许把 dashboard 文案问题修成 ledger 语义变更。

---

## 📊 评分标准

| 维度 | 权重 | 评估方式 |
|------|------|---------|
| **系统认知 & 语义建模** | 35% | 系统认知报告、业务词典、source of truth、release state 判断是否准确？ |
| **解决方案质量** | 25% | 修复是否正确解决根因（而非只治症状）？是否保留账本、路由、上线边界？ |
| **AI 协作质量** | 25% | 从 AI Collaboration Log 评估：你如何拆解问题、纠正 AI 的语义误判、验证输出？ |
| **代码质量与验证证据** | 15% | TypeScript 规范、合理抽象、清晰命名、测试/命令输出证据 |

### 🔍 AI Collaboration Log 评估细则

| 行为模式 | 评价 |
|---------|------|
| 向 AI 分段提问："先帮我梳理这个服务的数据流向"、"这个字段在业务上意味着什么？" | ✅ 体现了系统切分能力 |
| 让 AI 给出方案后追问："这样改会不会影响另一个服务的写入？" | ✅ 体现了全局意识 |
| 发现 AI 的方案有隐患后主动修正或引导 AI 调整 | ✅ 体现了深度理解 |
| 把整段代码或整个文件粘贴给 AI 说"帮我找 bug" | ⚠️ 缺乏切分能力 |
| AI 说什么改什么，不做验证 | ❌ 缺乏判断力 |
| 只关注让测试通过，不关注根因和系统影响 | ❌ 缺乏工程思维 |

---

## 📁 项目结构

```
senior-backend-challenge/
├── apps/
│   ├── legacy-app/              # REST API 服务
│   │   ├── src/
│   │   │   ├── analysis/        # 分析模块
│   │   │   └── shared/          # 数据库 & 消息队列
│   │   └── test/
│   │       └── bug-repro.spec.ts  # Part 2 TDD 测试
│   └── worker-service/          # 消息处理 Worker
│       └── src/
│           ├── processors/      # 消息处理器
│           ├── middleware/      # 中间件 (Part 1)
│           └── audience-integration/  # 受众数据集成 (Part 4)
├── packages/
│   └── shared-types/            # 共享类型定义
├── scripts/
│   ├── replay-event.ts          # Part 1: Replay 脚本
│   ├── process-chaos.ts         # Part 3: 脏数据处理
│   └── verify-submission.ts     # 提交完整性检查
├── ops/
│   ├── current-rollout-state.json
│   └── urgent-phase2-ticket.md
├── docs/
│   ├── CHALLENGE_BILLING_SEMANTICS.md
│   └── CHALLENGE_RELEASE_INTERRUPTION.md
├── debug-payloads/              # Payload 捕获目录
│   └── chaos-data-samples.json  # 脏数据样本
├── failed-records/              # 失败记录目录
├── solutions/                   # ⬅️ 你的交付物
│   ├── ai-collaboration-log.md  # ⚠️ 必需：AI 协作过程记录
│   ├── decision-log.md          # ⚠️ 必需：语义/source-of-truth 决策
│   ├── release-command-log.md   # ⚠️ 必需：上线状态与命令时间线
│   ├── part2-analysis.md        # 数据流向 & 根因分析
│   ├── part3-observability.md   # 数据质量分析
│   ├── part4-audience-trace.md  # 调用链路追踪
│   ├── part5-tradeoffs.md       # 系统设计方案
│   ├── part6-billing-semantics.md
│   └── part7-release-interruption.md
├── AGENTS.md
├── CLAUDE.md
├── GEMINI.md
├── docker-compose.yml
└── package.json
```

---

## ❓ 常见问题

**Q: 可以使用 AI 工具吗？**
A: **不只是可以，是要求你必须使用。** 这个挑战考的是你和 AI 如何协作解决问题。但请注意——我们更关注你的 **问题切分方式、领域理解深度以及对 AI 输出的判断力**，而不是代码生成速度。

**Q: 时间不够怎么办？**
A: 优先完成 Part 1 和 Part 2。但无论做到哪一步，**每个已完成部分的系统认知报告质量是第一优先级**。

**Q: 需要真的连接 AWS 吗？**
A: 不需要。本项目使用本地 MongoDB 和模拟的消息队列，所有测试都可以在本地完成。

---

祝你好运！ 🚀
