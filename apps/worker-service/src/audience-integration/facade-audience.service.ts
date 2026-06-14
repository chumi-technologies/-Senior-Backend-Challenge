/**
 * Facade Service - wraps third-party Audience API calls.
 *
 * Handles Playwright browser context management, authentication,
 * and data extraction from the audience analytics provider.
 */

import { chromium, Browser, BrowserContext } from 'playwright';
import { MockAuthPool } from './mock-auth-pool';
import { extractAudiencePayload } from './audience-response.mapper';

export class FacadeAudienceService {
    private authPool: MockAuthPool;
    private sharedBrowser: Browser | null = null;

    constructor() {
        this.authPool = new MockAuthPool();
    }

    /**
     * Fetches audience demographic data via Playwright browser context.
     *
     * @param mediaType - instagram | tiktok
     * @param mediaId - The media/influencer ID to query
     * @param context - Optional shared browser context for batch operations
     */
    async getAudienceV1ByPlaywright(
        mediaType: 'instagram' | 'tiktok',
        mediaId: string,
        context?: BrowserContext,
    ): Promise<any> {
        const url = `http://localhost:3001/api/v1/audience?media_type=${mediaType}&media_id=${mediaId}`;

        try {
            // Acquire authentication credentials from the pool
            const auth = await this.authPool.getNextAuth();
            const token = await this.authPool.getToken(auth);

            console.log(`[FacadeService] Fetching audience for ${mediaType}:${mediaId}`);
            console.log(`[FacadeService] Using auth: ${auth.username}`);

            let browser: Browser | null = null;
            let shouldCloseBrowser = false;

            // Create a new browser context if none was provided
            if (!context) {
                browser = await chromium.launch({ headless: true });
                context = await browser.newContext();
                shouldCloseBrowser = true;
            }

            // Make the API request through the browser context
            const response = await context.request.get(url, {
                headers: {
                    'authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            const audienceData = await response.json();

            // Validate API response status
            if (audienceData.status !== 'success') {
                console.error('[FacadeService] API returned non-success status');
                return null;
            }

            console.log('[FacadeService] Raw response:', JSON.stringify(audienceData).substring(0, 200));

            // Extract audience demographics from response
            const extracted = extractAudiencePayload(audienceData);

            if (!extracted) {
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
     * Batch fetch audience data for multiple media IDs.
     * Uses Promise.all for concurrent requests.
     */
    async batchGetAudience(requests: Array<{ mediaType: 'instagram' | 'tiktok'; mediaId: string }>) {
        console.log(`[FacadeService] Batch fetching ${requests.length} audience datasets`);

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
