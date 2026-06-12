/**
 * Audience Service - business logic layer for audience demographics.
 *
 * Orchestrates data fetching, caching, validation, and mapping
 * of influencer audience data from the facade layer.
 */

import { AudiencePayload, AudiencePlatform, FacadeAudienceService } from './facade-audience.service';

type InfluencerAudienceIds = Partial<Record<`${AudiencePlatform}_id`, string>>;

const PLATFORM_ID_FIELDS: Record<AudiencePlatform, keyof InfluencerAudienceIds> = {
    instagram: 'instagram_id',
    tiktok: 'tiktok_id',
};

interface UnifiedAudienceData {
    platform: AudiencePlatform;
    mediaId: string;
    gender?: AudiencePayload['gender'];
    age?: AudiencePayload['age'];
    geography?: AudiencePayload['geography'];
}

export class AudienceService {
    private facadeService: FacadeAudienceService;
    private cache: Map<string, any> = new Map();

    constructor() {
        this.facadeService = new FacadeAudienceService();
    }

    /**
     * Fetches audience demographic data for a single influencer.
     * Results are cached to avoid redundant API calls.
     */
    async fetchAudienceData(
        platform: AudiencePlatform,
        mediaId: string,
        options: { forceRefresh?: boolean } = {},
    ): Promise<UnifiedAudienceData | null> {
        this.logEvent('info', 'audience_fetch_requested', { platform, mediaId });

        // Check cache first
        const cacheKey = `${platform}:${mediaId}`;
        if (!options.forceRefresh && this.cache.has(cacheKey)) {
            this.logEvent('info', 'audience_cache_hit', { platform, mediaId });
            return this.cache.get(cacheKey);
        }

        try {
            // Fetch raw data from the facade layer
            const rawData = await this.facadeService.getAudienceV1ByPlaywright(
                platform,
                mediaId,
            );

            if (!rawData) {
                this.logEvent('warn', 'audience_facade_returned_no_data', { platform, mediaId });
                return null;
            }

            // Map to unified internal format
            const unifiedData: UnifiedAudienceData = {
                platform,
                mediaId,
                gender: rawData.gender,
                age: rawData.age,
                geography: rawData.geography,
            };

            // Validate data completeness
            if (!this.validateAudienceData(unifiedData)) {
                this.logEvent('warn', 'audience_validation_failed', { platform, mediaId });
                return null;
            }

            // Cache the result
            this.cache.set(cacheKey, unifiedData);

            this.logEvent('info', 'audience_fetch_succeeded', { platform, mediaId });
            return unifiedData;

        } catch (error) {
            this.logEvent('error', 'audience_fetch_failed', {
                platform,
                mediaId,
                errorName: (error as Error).name,
                message: (error as Error).message,
            });
            throw error;
        }
    }

    /**
     * Batch fetch audience data for multiple influencers.
     */
    async batchFetchAudienceData(
        influencerData: InfluencerAudienceIds[],
    ) {
        this.logEvent('info', 'audience_batch_fetch_requested', {
            influencerCount: influencerData.length,
        });

        const results = [];
        const errors = [];

        for (const data of influencerData) {
            try {
                for (const [platform, idField] of Object.entries(PLATFORM_ID_FIELDS) as Array<[AudiencePlatform, keyof InfluencerAudienceIds]>) {
                    const mediaId = data[idField];
                    if (!mediaId) {
                        continue;
                    }

                    const result = await this.fetchAudienceData(platform, mediaId);
                    if (result) results.push(result);
                    else errors.push({ platform, mediaId });
                }
            } catch (error) {
                this.logEvent('error', 'audience_batch_item_failed', {
                    errorName: (error as Error).name,
                    message: (error as Error).message,
                });
                errors.push({ error: (error as Error).message });
            }
        }

        return { results, errors };
    }

    private validateAudienceData(data: UnifiedAudienceData): boolean {
        return !!(data.gender || data.age || data.geography);
    }

    async cleanup() {
        await this.facadeService.cleanup();
    }

    private logEvent(level: 'info' | 'warn' | 'error', event: string, context: Record<string, unknown>): void {
        console.log(JSON.stringify({
            level,
            event,
            timestamp: new Date().toISOString(),
            ...context,
        }));
    }
}
