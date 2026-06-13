# Surgical Refactor Plan

> Complete before touching messy hot-path code.

## 1. Target

- File: `apps/worker-service/src/queue-poller.ts`
- Function / class: `QueuePoller.pollLoop()` and the per-file processing logic inside its `for` loop
- Why this is in scope: This is the worker hot path for message intake. It currently mixes queue listing, file I/O, JSON parsing, processor invocation, deletion, and error handling in one method. If we need to add characterization tests or tighten idempotency/error behavior, this is the smallest focused place to isolate behavior without rewriting the worker.

## 2. Current responsibility leak

Describe the smallest concrete responsibility leak. Do not propose a broad rewrite.

`pollLoop()` currently owns too many responsibilities:

- queue polling cadence
- file discovery
- individual message loading
- JSON parsing
- processor invocation
- success cleanup (`unlinkSync`)
- error swallowing with no structured failure path

That makes the hot path hard to characterize and risky to change. A bug in one responsibility can be hidden by the generic `Error processing message` branch, and any later retry or dead-letter behavior would need to be added into the same tangled loop. The smallest concrete leak is that "process one queue file" is embedded inline instead of being a separately testable unit.

## 3. Characterization test

- Existing behavior to lock: When a valid queue file is present, the worker reads it, parses one `AnalysisRequestedEvent`, calls `processor.process(event)`, and deletes the file only after successful processing. When parsing or processing fails, the file is left in place.
- Test file: `apps/worker-service/src/queue-poller.spec.ts` or a focused test adjacent to `queue-poller.ts`
- Expected failure mode if behavior changes accidentally: A regression could delete the file before successful processing, process the same file more than once in a single loop, or swallow malformed JSON in a way that loses debuggability and breaks future retry/dead-letter work.

## 4. Extraction boundary

- Extracted helper / function: `processQueueFile(filepath: string): Promise<'processed' | 'failed'>`
- Inputs: Absolute file path plus the existing injected `processor`
- Outputs: A simple outcome enum/result indicating whether processing succeeded or failed
- Side effects: Reads the file, parses JSON, calls `processor.process(event)`, deletes the file on success, logs a structured failure on error
- Why this is the smallest safe boundary: It extracts only the per-message unit of work and leaves polling cadence, directory selection, and service startup unchanged. This improves characterization testing and future dead-letter instrumentation without introducing a new queue framework or broad architecture rewrite.

## 5. Explicitly rejected AI rewrite ideas

| Suggested rewrite | Why rejected |
|---|---|
| Rewrite the worker as a fully async streaming framework with a new queue abstraction | Too large for a surgical hot-path change and violates the challenge instruction to avoid broad rewrites |
| Replace local queue files with Kafka/SQS immediately | This changes infrastructure and operational semantics rather than isolating one responsibility leak |
| Rewrite the worker in Rust before addressing correctness and observability | Not realistic for the two-week constraint and unnecessary for a focused hot-path refactor |

## 6. Verification

- Tests run: Characterization tests for success path, malformed JSON path, and processor-failure path before any behavior change
- Command output: Capture test output showing that successful processing deletes the file and failure leaves it available for follow-up handling
- Remaining risk: This refactor alone does not solve throughput limits, backpressure, or dead-letter operations; it only creates a safer extraction boundary for later incremental improvements
