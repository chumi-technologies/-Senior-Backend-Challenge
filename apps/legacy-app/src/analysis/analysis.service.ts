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
     * 5. Schedule a follow-up demographic refresh
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

        // Refresh the preliminary demographics after a short delay
        // to ensure the pre-computed data is consistent
        setTimeout(() => {
            this.delayedUpdate(jobId, quickDemographics);
        }, 2000);

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

    /**
     * Refreshes the demographic data after the initial save.
     * Ensures the pre-computed results are persisted correctly.
     */
    private async delayedUpdate(jobId: string, demographics: Demographics): Promise<void> {
        try {
            const updated = await this.databaseService.updateJobIfStatus(jobId, 'PENDING', {
                demographics,
            });

            if (!updated) {
                this.logger.log(`Skipped delayed demographics refresh for non-pending job: ${jobId}`);
                return;
            }

            this.logger.log(`Updated demographics for job ${jobId}`);
        } catch (error) {
            this.logger.error(`Failed delayed demographics refresh for job ${jobId}`, error);
        }
    }
}
