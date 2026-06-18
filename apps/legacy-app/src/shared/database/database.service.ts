import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import mongoose, { Connection } from 'mongoose';
import type { AnalysisJob } from '@senior-challenge/shared-types';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/analysis_db';

/**
 * Database service for MongoDB operations.
 * Uses raw Mongoose connection for simplicity.
 */
@Injectable()
export class DatabaseService implements OnModuleInit {
    private readonly logger = new Logger(DatabaseService.name);
    private connection: Connection | null = null;

    async onModuleInit(): Promise<void> {
        try {
            await mongoose.connect(MONGODB_URI);
            this.connection = mongoose.connection;
            this.logger.log('✅ Connected to MongoDB');
        } catch (error) {
            this.logger.error('❌ Failed to connect to MongoDB', error);
            throw error;
        }
    }

    /**
     * Saves an analysis job to the database.
     */
    async saveJob(job: AnalysisJob): Promise<void> {
        const collection = this.connection?.collection('analysis_jobs');
        if (!collection) {
            throw new Error('Database not connected');
        }

        await collection.updateOne(
            { jobId: job.jobId },
            { $set: job },
            { upsert: true },
        );
    }

    /**
     * Finds an analysis job by ID.
     */
    async findJobById(jobId: string): Promise<AnalysisJob | null> {
        const collection = this.connection?.collection('analysis_jobs');
        if (!collection) {
            throw new Error('Database not connected');
        }

        const doc = await collection.findOne({ jobId });
        return doc as unknown as AnalysisJob | null;
    }

    /**
     * Updates specific fields of an analysis job.
     *
     * Note: this is a non-conditional update. Callers that need to protect
     * concurrent writes (e.g. the delayed quick-demographics refresh racing
     * the Worker COMPLETED write) MUST use `updateJobIfNotCompleted` instead.
     */
    async updateJob(jobId: string, updates: Partial<AnalysisJob>): Promise<void> {
        const collection = this.connection?.collection('analysis_jobs');
        if (!collection) {
            throw new Error('Database not connected');
        }

        await collection.updateOne(
            { jobId },
            { $set: { ...updates, updatedAt: new Date().toISOString() } },
        );
    }

    /**
     * Atomic conditional update for the delayed quick-demographics refresh.
     *
     * Fix for ticket #4521 (race condition):
     *   The previous implementation did `findJobById` followed by `updateJob`,
     *   which is a classic TOCTOU read-then-write pattern. Between the read
     *   and the write, the Worker can flip the job to COMPLETED, and the
     *   subsequent unconditional write will overwrite high-confidence results
     *   with low-confidence quick-demographics.
     *
     *   The correct fix is a single atomic MongoDB updateOne whose filter
     *   refuses to match COMPLETED documents. The database guarantees that
     *   either the document was non-COMPLETED at the moment of the write
     *   (and the write is applied), or it was COMPLETED (and nothing happens).
     *   No interleaving is possible.
     *
     * Returns true if a document was actually updated, false if the guard
     * filter rejected the update (i.e. the job was already COMPLETED, or
     * the job no longer exists).
     */
    async updateJobIfNotCompleted(
        jobId: string,
        updates: Partial<AnalysisJob>,
    ): Promise<boolean> {
        const collection = this.connection?.collection('analysis_jobs');
        if (!collection) {
            throw new Error('Database not connected');
        }

        const result = await collection.updateOne(
            { jobId, status: { $ne: 'COMPLETED' } },
            { $set: { ...updates, updatedAt: new Date().toISOString() } },
        );

        return result.matchedCount === 1;
    }
}
