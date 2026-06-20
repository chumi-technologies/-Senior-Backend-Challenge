import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../shared/database/database.service';
import { MessageQueueService } from '../shared/message-queue/message-queue.service';
import { CreateAnalysisDto } from './models/create-analysis.dto';
import type { AnalysisJob, Demographics, AnalysisRequestedEvent } from '@senior-challenge/shared-types';

/**
 * Analysis Service - handles analysis job creation and retrieval.
 */
@Injectable()
export class AnalysisService {
    private readonly logger = new Logger(AnalysisService.name);

    constructor(
        private readonly databaseService: DatabaseService,
        private readonly messageQueueService: MessageQueueService,
    ) { }

    /**
     * Creates a new analysis job.
     *
     * Flow:
     * 1. Generate unique job ID
     * 2. Run quick pre-computation for immediate user feedback
     * 3. Persist to database so the user can see a "pending" result immediately
     * 4. Publish event to message queue for full analysis by WorkerService
     *
     * NOTE: This handler only *seeds* preliminary demographics (confidence 0.3).
     * The final, authoritative demographics are owned by the worker pipeline
     * (AnalysisProcessor). The request path must NOT write demographics again after
     * publishing the event — a delayed re-write races the worker and can overwrite the
     * real COMPLETED result with stale preliminary data (ticket #4521).
     */
    async createAnalysis(dto: CreateAnalysisDto): Promise<AnalysisJob> {
        const jobId = uuidv4();
        const now = new Date().toISOString();

        // Pre-compute quick demographics so the user gets immediate feedback
        // while the full pipeline is processing via the Worker
        const quickDemographics = this.calculateQuickDemographics(dto.userId);

        const job: AnalysisJob = {
            jobId,
            userId: dto.userId,
            dataUrl: dto.dataUrl,
            status: 'PENDING',
            demographics: quickDemographics,
            createdAt: now,
            updatedAt: now,
        };

        // Persist the job with preliminary results
        await this.databaseService.saveJob(job);
        this.logger.log(`✅ Job created: ${jobId}`);

        // Publish event for the Worker to pick up and run full analysis
        const event: AnalysisRequestedEvent = {
            eventType: 'AnalysisRequested',
            jobId,
            userId: dto.userId,
            dataUrl: dto.dataUrl,
            timestamp: now,
        };

        await this.messageQueueService.publishEvent(event);

        // Intentionally no post-publish demographics write here. The worker pipeline
        // is the single writer of final demographics; re-persisting the preliminary
        // estimate after publishing would race the worker and clobber real results
        // (ticket #4521). The preliminary record was already saved above.

        return job;
    }

    /**
     * Gets an analysis job by ID.
     */
    async getAnalysisById(jobId: string): Promise<AnalysisJob | null> {
        return this.databaseService.findJobById(jobId);
    }

    /**
     * Quick demographic estimation based on user profile heuristics.
     * Provides immediate feedback while the full analysis pipeline runs.
     */
    private calculateQuickDemographics(userId: string): Demographics {
        const ageRanges = ['18-24', '25-34', '35-44', '45-54'];
        const genders = ['male', 'female', 'other'];
        const locations = ['US', 'UK', 'CA', 'AU'];

        return {
            ageRange: ageRanges[Math.floor(Math.random() * ageRanges.length)],
            gender: genders[Math.floor(Math.random() * genders.length)],
            location: locations[Math.floor(Math.random() * locations.length)],
            confidence: 0.3,
        };
    }
}
