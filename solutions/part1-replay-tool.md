# Part 1: Capture & Replay — 实现记录

## 1. 实现思路

本项目用 `local-queue/` 目录模拟 AWS SQS：LegacyApp 写入 JSON 文件，WorkerService 轮询读取文件并调用 `AnalysisProcessor.process(event)`。

Capture & Replay 的目标是把 Worker 实际收到的输入保存下来，之后可以绕过队列直接重放同一条消息。

### Capture 位置

捕获点放在 `QueuePoller` 中：

1. 从 `local-queue/` 读取 JSON 文件。
2. `JSON.parse` 成 `AnalysisRequestedEvent`。
3. 在调用 `processor.process(event)` 前执行 capture。

这样保存的是 Worker 实际处理的 payload，而不是 LegacyApp 发布前的中间对象。

### Capture 开关

只有在环境变量开启时才捕获：

```bash
CAPTURE_MODE=true pnpm run start:worker
```

默认关闭，避免持续写文件、扩大敏感数据落盘范围，以及引入不必要的 IO 开销。

### Payload 文件结构

保存到 `debug-payloads/` 的文件不是裸 event，而是 envelope：

```typescript
interface CaptureEnvelope<TPayload = AnalysisRequestedEvent> {
  schemaVersion: 1;
  capturedAt: string;
  source: 'local-queue' | 'sqs' | 'manual';
  messageId: string;
  messageFile?: string;
  attributes?: Record<string, string>;
  rawBody?: unknown;
  payload: TPayload;
}
```

其中：

- `payload` 是 replay 时真正传给 Worker handler 的输入。
- `capturedAt/source/messageFile/rawBody` 是排查问题时需要的上下文。
- `schemaVersion` 给后续格式演进留空间。

文件名策略：

```text
{eventType}-{jobId}-{capturedAt}.json
```

示例：

```text
debug-payloads/analysis-requested-capture-replay-test-20260612-173838031Z.json
```

### Replay 策略

Replay 脚本支持：

```bash
pnpm run replay -- --file=debug-payloads/job-xxx.json
```

执行流程：

1. 读取指定 JSON 文件。
2. 如果文件是 envelope，取 `payload` 字段。
3. 如果文件是裸 payload，直接使用整个 JSON。
4. 校验它是 `AnalysisRequestedEvent`。
5. `new AnalysisProcessor()`。
6. 直接调用 `processor.process(event)`。

这样 replay 不需要启动 LegacyApp，也不需要重新写入 `local-queue/`。

## 2. 核心代码

### capture.middleware.ts

核心逻辑在 `apps/worker-service/src/middleware/capture.middleware.ts`：

```typescript
export async function captureMessage(
    payload: AnalysisRequestedEvent,
    metadata: CaptureMetadata,
): Promise<string | null> {
    if (process.env.CAPTURE_MODE !== 'true') {
        return null;
    }

    try {
        const rootDir = findRepositoryRoot(process.cwd());
        const captureDir = path.join(rootDir, 'debug-payloads');
        fs.mkdirSync(captureDir, { recursive: true });

        const capturedAt = new Date().toISOString();
        const messageId = metadata.messageId ?? payload.jobId;
        const envelope: CaptureEnvelope = {
            schemaVersion: 1,
            capturedAt,
            source: metadata.source,
            messageId,
            messageFile: metadata.messageFile,
            attributes: metadata.attributes,
            rawBody: metadata.rawBody,
            payload,
        };

        const filename = buildCaptureFilename(payload, capturedAt, messageId);
        const filepath = path.join(captureDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(envelope, null, 2));
        console.log(`Captured payload: ${filepath}`);

        return filepath;
    } catch (error) {
        console.error('Failed to capture payload:', (error as Error).message);
        return null;
    }
}
```

`QueuePoller` 在调用 processor 前执行：

```typescript
await captureMessage(event, {
    source: 'local-queue',
    messageId: event.jobId,
    messageFile: file,
    rawBody: content,
});

await this.processor.process(event);
```

### replay-event.ts

核心逻辑在 `scripts/replay-event.ts`：

```typescript
const parsed = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as ReplayInput;
const event = extractEvent(parsed);

const processor = new AnalysisProcessor();
await processor.process(event);
```

Replay 同时支持 envelope 和裸 payload：

```typescript
function extractEvent(input: ReplayInput): AnalysisRequestedEvent {
    const candidate = hasPayload(input) ? input.payload : input;

    if (!isAnalysisRequestedEvent(candidate)) {
        throw new Error('Replay file does not contain a valid AnalysisRequestedEvent payload');
    }

    return candidate;
}
```

## 3. 遇到的问题和解决方法

### Worker 初始化连接问题

`AnalysisProcessor` 构造函数里原本触发异步 MongoDB 连接，但 `process()` 不等待连接完成。Replay 直接调用 processor 时更容易遇到连接尚未初始化完成的问题。

解决方式：在 `AnalysisProcessor` 内部保存 `ready` Promise，并在 `process()` 开始时等待：

```typescript
private readonly ready: Promise<void>;

constructor() {
    this.ready = this.initializeDatabase();
}

async process(event: AnalysisRequestedEvent): Promise<void> {
    await this.ready;
    // ...
}
```

### 路径问题

项目中的本地队列依赖 `process.cwd()`，从不同目录启动时可能指向不同的 `local-queue/`。Capture 文件不应受这个影响，所以 middleware 会向上查找 `pnpm-workspace.yaml`，把文件稳定写到仓库根目录的 `debug-payloads/`。

### Replay 文件格式兼容

为了方便手工构造调试样本，Replay 同时支持：

```json
{ "payload": { "eventType": "AnalysisRequested" } }
```

和：

```json
{ "eventType": "AnalysisRequested" }
```

## 4. 验收结果

Worker 构建：

```bash
pnpm --filter worker-service build

> worker-service@1.0.0 build
> tsc
```

缺少 `--file` 时会给出明确错误：

```bash
pnpm exec tsx scripts/replay-event.ts

Replay failed: Missing required argument: --file=<path-to-payload.json>
```

开启 capture 生成临时 payload：

```bash
CAPTURE_MODE=true pnpm exec tsx -e "..."

Captured payload: /Users/david/Documents/github/chumi/-Senior-Backend-Challenge/debug-payloads/analysis-requested-capture-replay-test-20260612-173838031Z.json
```

Replay 验证：

```bash
pnpm run replay -- --file=debug-payloads/analysis-requested-capture-replay-test-20260612-173838031Z.json

Replaying payload from: /Users/david/Documents/github/chumi/-Senior-Backend-Challenge/debug-payloads/analysis-requested-capture-replay-test-20260612-173838031Z.json
Replay jobId: capture-replay-test
Connected to MongoDB
Processing job: capture-replay-test
Job completed: capture-replay-test
Replay completed for jobId: capture-replay-test
```
