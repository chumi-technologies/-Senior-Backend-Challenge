# 补充说明：边界补强

最终代码里有少量改动看起来超过了题目最小实现，主要是 review 和本地完整验证后补上的边界修复。

这些改动不是新增题目，也不是把系统完整生产化。它们的目标很简单：

- 让 README 中的本地启动方式真正可用，例如 LegacyApp 和 Worker 都读写仓库根目录的 `local-queue/`。
- 让 replay 结果可信：如果 job 不存在、状态不允许处理，或 Worker 实际处理失败，replay 不应打印成功。
- 避免 Part 2 已经修过的“旧写入覆盖新结果”在 Worker/replay/重复队列消息路径里再次出现。
- 让 Part 3 文档中的 runtime validation 和结构化日志也真正覆盖 Worker 生产路径，而不只停留在 chaos script。
- 让 Part 4 的 Facade 修复保持在适配边界内，未知结构记录下来，但不猜测、不提前开放未验证平台。

本次仍然刻意没有实现更大的生产化能力，例如真实 SQS、分布式锁、replay UI、dry-run/clone job、完整数据脱敏策略，或全仓库 lint/test 脚手架。

因此可以把这些改动理解为对 Part 1-4 的小范围可靠性补强，而不是额外架构重写。