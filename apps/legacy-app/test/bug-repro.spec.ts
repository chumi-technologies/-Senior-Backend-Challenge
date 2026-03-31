import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisService } from '../src/analysis/analysis.service';
import { DatabaseService } from '../src/shared/database/database.service';
import { MessageQueueService } from '../src/shared/message-queue/message-queue.service';

/**
 * 【你的任务：TDD 复现竞态条件 Bug】
 * 
 * 在修复底层 LegacyApp / WorkerService 双写的 Bug 之前，请在此处写一个自动化测试来证实系统确实存在跳变/覆盖漏洞。
 * 通过在内存中 mock DatabaseService 响应或模拟真实时序，让测试能够稳定地 Fail，从而验证你的假设。
 * 在你的重构完成之后，这段测试应该顺利通过 (Green)。
 */
describe('Concurrency Race Condition (Bug Repro)', () => {
  let service: AnalysisService;

  beforeEach(async () => {
    // 搭建测试上下文，推荐 Mock 掉外部持久层依赖以便精确控制响应时延
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisService,
        {
          provide: DatabaseService,
          useValue: { /* 留给候选人实现 */ },
        },
        {
          provide: MessageQueueService,
          useValue: { /* 留给候选人实现 */ },
        },
      ],
    }).compile();

    service = module.get<AnalysisService>(AnalysisService);
  });

  it('should intentionally reproduce the data overwrite / race condition bug before fix', async () => {
    // 你的测试逻辑:
    // 1. 发起分析请求
    // 2. 模拟 Worker 先行完成
    // 3. 模拟 LegacyApp 的延时更新覆盖掉 Worker 的有效数据
    // 4. 断言结果是否被错误篡改
    throw new Error('测试尚未实现：请写一个稳定的竞态重现用例');
  });
});
