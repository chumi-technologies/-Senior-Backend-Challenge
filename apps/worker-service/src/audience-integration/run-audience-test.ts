/**
 * Audience Integration Test Runner
 *
 * Simulates a real-world batch fetch scenario: fetching audience
 * demographics for multiple influencers from the third-party API.
 *
 * Usage: pnpm simulate:audience-bug
 */

import { startMockAudienceServer } from './mock-audience-api';
import { AudienceService } from './audience.service';

async function main() {
    console.log('='.repeat(60));
    console.log('🎯 Audience Data Integration Test');
    console.log('='.repeat(60));
    console.log();

    // 1. Start mock API server
    await startMockAudienceServer();
    console.log('✅ Mock API server started\n');

    // 2. Prepare test data — a mix of influencer profiles
    const testInfluencers = [
        { instagram_id: '67890', tiktok_id: '11111' },
        { instagram_id: '12345' },
        { instagram_id: '99999', tiktok_id: '22222' },
    ];

    console.log(`📊 Testing with ${testInfluencers.length} influencers:`);
    testInfluencers.forEach((inf, idx) => {
        console.log(`   ${idx + 1}. instagram_id: ${inf.instagram_id || 'N/A'}, tiktok_id: ${inf.tiktok_id || 'N/A'}`);
    });
    console.log();

    // 3. Create service instance
    const audienceService = new AudienceService();

    // 4. Batch fetch
    console.log('🚀 Starting batch fetch...\n');
    const { results, errors } = await audienceService.batchFetchAudienceData(testInfluencers);

    // 5. Report
    console.log('\n' + '='.repeat(60));
    console.log('📈 RESULTS');
    console.log('='.repeat(60));
    console.log(`✅ Success: ${results.length} requests`);
    console.log(`❌ Errors: ${errors.length}`);
    console.log();

    if (errors.length > 0) {
        console.log('🐛 Failed Requests:');
        errors.forEach((err, idx) => {
            console.log(`   ${idx + 1}. Platform: ${err.platform}, MediaId: ${err.mediaId}`);
        });
    }

    if (results.length > 0) {
        console.log('\n✨ Successful Data (sample):');
        console.log(JSON.stringify(results[0], null, 2).substring(0, 300) + '...');
    }

    // Cleanup
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
