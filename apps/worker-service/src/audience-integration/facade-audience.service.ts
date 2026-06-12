/**
 * Facade Service - wraps third-party Audience API calls.
 *
 * Handles Playwright browser context management, authentication,
 * and data extraction from the audience analytics provider.
 */

import { chromium, Browser, BrowserContext } from 'playwright';
import { MockAuthPool } from './mock-auth-pool';

export type AudiencePlatform = 'instagram' | 'tiktok';

interface AudienceMetric {
    label: string;
    value: number;
}

export interface AudiencePayload {
    gender?: AudienceMetric[];
    age?: AudienceMetric[];
    geography?: {
        countries?: Array<{ name: string; code: string; percentage: number }>;
    };
}

interface AudienceExtractor {
    name: string;
    extract: (response: unknown) => AudiencePayload | null;
}

const AUDIENCE_EXTRACTORS: AudienceExtractor[] = [
    {
        name: 'standard-v1',
        extract: (response) => {
            const root = asRecord(response);
            const data = asRecord(root?.data);
            return toAudiencePayload(data?.audience);
        },
    },
    {
        name: 'legacy-demographics',
        extract: (response) => {
            const root = asRecord(response);
            const audienceData = asRecord(root?.audience_data);
            return toAudiencePayload(audienceData?.demographics);
        },
    },
];

export class FacadeAudienceService {
    private authPool: MockAuthPool;
    private sharedBrowser: Browser | null = null;

    constructor() {
        this.authPool = new MockAuthPool();
    }

    /**
     * Fetches audience demographic data via Playwright browser context.
     *
     * @param mediaType - audience platform identifier
     * @param mediaId - The media/influencer ID to query
     * @param context - Optional shared browser context for batch operations
     */
    async getAudienceV1ByPlaywright(
        mediaType: AudiencePlatform,
        mediaId: string,
        context?: BrowserContext,
    ): Promise<AudiencePayload | null> {
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
            const extracted = this.extractAudienceData(audienceData, mediaType, mediaId);

            if (!extracted) {
                console.error('[FacadeService] ⚠️ Audience data could not be extracted');
                console.error('[FacadeService] Available keys:', Object.keys(audienceData));
                console.error('[FacadeService] Tried extractors:', AUDIENCE_EXTRACTORS.map((extractor) => extractor.name).join(', '));
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
    async batchGetAudience(requests: Array<{ mediaType: AudiencePlatform; mediaId: string }>) {
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

    private extractAudienceData(
        response: unknown,
        mediaType: AudiencePlatform,
        mediaId: string,
    ): AudiencePayload | null {
        for (const extractor of AUDIENCE_EXTRACTORS) {
            const extracted = extractor.extract(response);
            if (extracted) {
                console.log(`[FacadeService] Extracted audience using ${extractor.name} for ${mediaType}:${mediaId}`);
                return extracted;
            }
        }

        return null;
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    return value as Record<string, unknown>;
}

function toAudiencePayload(value: unknown): AudiencePayload | null {
    const record = asRecord(value);
    if (!record) {
        return null;
    }

    if (Array.isArray(record.gender) || Array.isArray(record.age) || asRecord(record.geography)) {
        return record as AudiencePayload;
    }

    return null;
}
