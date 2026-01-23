/**
 * 🎯 Audience Integration Runner
 * 
 * 模拟真实场景：从多个 influencers 批量获取 audience 数据
 * 
 * 运行此脚本查看bug:
 * pnpm run simulate:audience-bug
 * 
 * 🐛 预期问题：
 * - mediaId=12345 会返回 null (老数据格式未处理)
 * - 其他 mediaId 正常返回
 * 
 * 💡 挑战：候选人需要：
 * 1. 理解完整的调用链 (Runner → AudienceService → FacadeService → MockAPI)
 * 2. 发现 facade-audience.service.ts 中数据提取逻辑的问题
 * 3. 修复以支持老格式的API响应
 * 4. 考虑是否需要添加更robust的错误处理
 */

import { startMockAudienceServer } from './mock-audience-api';
import { AudienceService } from './audience.service';

async function main() {
    console.log('='.repeat(60));
    console.log('🎯 Audience Data Integration Test');
    console.log('='.repeat(60));
    console.log();

    // 1. 启动模拟API服务器
    await startMockAudienceServer();
    console.log('✅ Mock API server started\n');

    //  2. 准备测试数据
    const testInfluencers = [
        { instagram_id: '67890', tiktok_id: '11111' }, // 这些会成功
        { instagram_id: '12345' },  // 🐛 这个会返回 null（老格式）
        { instagram_id: '99999', tiktok_id: '22222' }, // 这些会成功
    ];

    console.log(`📊 Testing with ${testInfluencers.length} influencers:`);
    testInfluencers.forEach((inf, idx) => {
        console.log(`   ${idx + 1}. instagram_id: ${inf.instagram_id || 'N/A'}, tiktok_id: ${inf.tiktok_id || 'N/A'}`);
    });
    console.log();

    // 3. 创建服务实例
    const audienceService = new AudienceService();

    // 4. 批量获取数据
    console.log('🚀 Starting batch fetch...\n');
    const { results, errors } = await audienceService.batchFetchAudienceData(testInfluencers);

    // 5. 报告结果
    console.log('\n' + '='.repeat(60));
    console.log('📈 RESULTS');
    console.log('='.repeat(60));
    console.log(`✅ Success: ${results.length}/${testInfluencers.length * 1.5} requests`);
    console.log(`❌ Errors: ${errors.length}`);
    console.log();

    if (errors.length > 0) {
        console.log('🐛 Failed Requests:');
        errors.forEach((err, idx) => {
            console.log(`   ${idx + 1}. Platform: ${err.platform}, MediaId: ${err.mediaId}`);
        });
        console.log();
        console.log('💡 Hint: Check the logs above to see where the data became null');
        console.log('💡 Try adding console.logs in facade-audience.service.ts to see the raw response');
    }

    if (results.length > 0) {
        console.log('✨ Successful Data (sample):');
        console.log(JSON.stringify(results[0], null, 2).substring(0, 300) + '...');
    }

    // 清理
    await audienceService.cleanup();
    process.exit(errors.length > 0 ? 1 : 0);
}

// Run
if (require.main === module) {
    main().catch(error => {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    });
}
