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
        console.log(`[AudienceService] Fetching audience for ${platform}:${mediaId}`);

        // Check cache first
        const cacheKey = `${platform}:${mediaId}`;
        if (!options.forceRefresh && this.cache.has(cacheKey)) {
            console.log('[AudienceService] Using cached data');
            return this.cache.get(cacheKey);
        }

        try {
            // Fetch raw data from the facade layer
            const rawData = await this.facadeService.getAudienceV1ByPlaywright(
                platform,
                mediaId,
            );

            if (!rawData) {
                console.error('[AudienceService] ❌ No data returned from facade layer');
                console.error('[AudienceService] mediaId:', mediaId);
                console.error('[AudienceService] platform:', platform);
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
                console.error('[AudienceService] Data validation failed');
                return null;
            }

            // Cache the result
            this.cache.set(cacheKey, unifiedData);

            console.log('[AudienceService] ✅ Successfully fetched and mapped audience data');
            return unifiedData;

        } catch (error) {
            console.error('[AudienceService] Error fetching audience:', (error as Error).message);
            throw error;
        }
    }

    /**
     * Batch fetch audience data for multiple influencers.
     */
    async batchFetchAudienceData(
        influencerData: InfluencerAudienceIds[],
    ) {
        console.log(`[AudienceService] Batch fetching for ${influencerData.length} influencers`);

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
                console.error('[AudienceService] Batch item failed:', (error as Error).message);
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
}
