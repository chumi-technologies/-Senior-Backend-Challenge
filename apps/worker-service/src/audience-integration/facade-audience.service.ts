/**
 * Facade Service - 包装第三方 Audience API 调用
 * 
 * 模拟真实的 facade-upfluence.service.ts 逻辑：
 * - 使用 Playwright browser context
 * - Auth management
 * - 错误处理
 * 
 * 🐛 核心 BUG: 数据提取逻辑对不同的响应格式处理不当
 */

import { chromium, Browser, BrowserContext } from 'playwright';
import { MockAuthPool } from './mock-auth-pool';

export class FacadeAudienceService {
    private authPool: MockAuthPool;
    private sharedBrowser: Browser | null = null;

    constructor() {
        this.authPool = new MockAuthPool();
    }

    /**
     * 获取 Audience 数据
     * 
     * @param mediaType - instagram | tiktok
     * @param mediaId - 媒体ID
     * @param context - 可选的共享浏览器上下文
     */
    async getAudienceV1ByPlaywright(
        mediaType: 'instagram' | 'tiktok',
        mediaId: string,
        context?: BrowserContext,
    ): Promise<any> {
        const url = `http://localhost:3001/api/v1/audience?media_type=${mediaType}&media_id=${mediaId}`;

        try {
            // 获取认证
            const auth = await this.authPool.getNextAuth();
            const token = await this.authPool.getToken(auth);

            console.log(`[FacadeService] Fetching audience for ${mediaType}:${mediaId}`);
            console.log(`[FacadeService] Using auth: ${auth.username}`);

            let browser: Browser | null = null;
            let shouldCloseBrowser = false;

            // 如果没有提供 context，创建新的
            if (!context) {
                browser = await chromium.launch({ headless: true });
                context = await browser.newContext();
                shouldCloseBrowser = true;
            }

            // 发起请求
            const response = await context.request.get(url, {
                headers: {
                    'authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            const audienceData = await response.json();

            // 🐛 BUG核心：数据提取逻辑
            // 预期路径: data.audience.gender
            // 但是对于 mediaId=12345，结构是 audience_data.demographics.gender
            // 这里只处理了"新"格式，没有处理"老"格式
            if (audienceData.status !== 'success') {
                console.error('[FacadeService] API returned non-success status');
                return null;
            }

            console.log('[FacadeService] Raw response:', JSON.stringify(audienceData).substring(0, 200));

            /*
             * 🐛 这里是问题所在！
             * 如果 API 返回的是老格式（audience_data），这里就会返回 undefined
             * 因为代码只检查了新格式（data.audience）
             */
            const extracted = audienceData.data?.audience;

            if (!extracted) {
                // 这是候选人会看到的日志
                console.error('[FacadeService] ⚠️ Audience data is NULL - why??');
                console.error('[FacadeService] Available keys:', Object.keys(audienceData));
            }

            if (shouldCloseBrowser && browser) {
                await browser.close();
            }

            return extracted;

        } catch (error) {
            console.error('[FacadeService] Failed to fetch audience:', (error as Error).message);
            throw error;
        }
    }

    /**
     * 批量获取 - 模拟真实场景中的并发问题
     */
    async batchGetAudience(requests: Array<{ mediaType: 'instagram' | 'tiktok'; mediaId: string }>) {
        console.log(`[FacadeService] Batch fetching ${requests.length} audience datasets`);

        // 🐛 BUG场景: 并发调用时可能重用同一个 auth
        // 真实场景中应该共享 browser context 来减少开销

        const results = await Promise.all(
            requests.map(req =>
                this.getAudienceV1ByPlaywright(req.mediaType, req.mediaId)
            )
        );

        const successCount = results.filter(r => r !== null).length;
        console.log(`[FacadeService] Batch complete: ${successCount}/${requests.length} succeeded`);

        return results;
    }

    async cleanup() {
        if (this.sharedBrowser) {
            await this.sharedBrowser.close();
        }
    }
}
