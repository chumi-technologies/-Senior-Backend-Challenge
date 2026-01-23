/**
 * Audience Service - 业务逻辑层
 * 
 * 模拟真实的 audience.service.ts:
 * - 数据映射
 * - 缓存检查
 * - 验证逻辑
 * 
 * 🎯 挑战目标：
 * 候选人需要追踪整个调用链，找到为什么某些 mediaId 返回 null
 */

import { FacadeAudienceService } from './facade-audience.service';

interface UnifiedAudienceData {
    platform: string;
    mediaId: string;
    gender?: Array<{ label: string; value: number }>;
    age?: Array<{ label: string; value: number }>;
    geography?: any;
}

export class AudienceService {
    private facadeService: FacadeAudienceService;
    private cache: Map<string, any> = new Map();

    constructor() {
        this.facadeService = new FacadeAudienceService();
    }

    /**
     * 获取受众数据
     * 
     * 🐛 这里也可能有问题：数据映射逻辑依赖于 facade 返回的格式
     */
    async fetchAudienceData(
        platform: 'instagram' | 'tiktok',
        mediaId: string,
        options: { forceRefresh?: boolean } = {},
    ): Promise<UnifiedAudienceData | null> {
        console.log(`[AudienceService] Fetching audience for ${platform}:${mediaId}`);

        // 检查缓存
        const cacheKey = `${platform}:${mediaId}`;
        if (!options.forceRefresh && this.cache.has(cacheKey)) {
            console.log('[AudienceService] Using cached data');
            return this.cache.get(cacheKey);
        }

        try {
            // 从 Facade 层获取原始数据
            const rawData = await this.facadeService.getAudienceV1ByPlaywright(
                platform,
                mediaId,
            );

            if (!rawData) {
                // 🚨 候选人会在这里看到问题
                console.error('[AudienceService] ❌ No data returned from facade layer');
                console.error('[AudienceService] mediaId:', mediaId);
                console.error('[AudienceService] platform:', platform);
                return null;
            }

            // 映射到统一格式
            const unifiedData: UnifiedAudienceData = {
                platform,
                mediaId,
                gender: rawData.gender,
                age: rawData.age,
                geography: rawData.geography,
            };

            // 验证数据
            if (!this.validateAudienceData(unifiedData)) {
                console.error('[AudienceService] Data validation failed');
                return null;
            }

            // 缓存
            this.cache.set(cacheKey, unifiedData);

            console.log('[AudienceService] ✅ Successfully fetched and mapped audience data');
            return unifiedData;

        } catch (error) {
            console.error('[AudienceService] Error fetching audience:', (error as Error).message);
            throw error;
        }
    }

    /**
     * 批量获取 - 模拟真实的批量场景
     */
    async batchFetchAudienceData(
        influencerData: Array<{ instagram_id?: string; tiktok_id?: string }>,
    ) {
        console.log(`[AudienceService] Batch fetching for ${influencerData.length} influencers`);

        const results = [];
        const errors = [];

        for (const data of influencerData) {
            try {
                if (data.instagram_id) {
                    const result = await this.fetchAudienceData('instagram', data.instagram_id);
                    if (result) results.push(result);
                    else errors.push({ platform: 'instagram', mediaId: data.instagram_id });
                }
                if (data.tiktok_id) {
                    const result = await this.fetchAudienceData('tiktok', data.tiktok_id);
                    if (result) results.push(result);
                    else errors.push({ platform: 'tiktok', mediaId: data.tiktok_id });
                }
            } catch (error) {
                console.error('[AudienceService] Batch item failed:', (error as Error).message);
                errors.push({ error: (error as Error).message });
            }
        }

        return { results, errors };
    }

    private validateAudienceData(data: UnifiedAudienceData): boolean {
        // 简单验证
        return !!(data.gender || data.age || data.geography);
    }

    async cleanup() {
        await this.facadeService.cleanup();
    }
}
