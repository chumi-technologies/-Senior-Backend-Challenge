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
     * Updates a job only while it is still in the expected state.
     * This keeps delayed low-priority writes from overwriting newer worker results.
     */
    async updateJobIfStatus(
        jobId: string,
        expectedStatus: AnalysisJob['status'],
        updates: Partial<AnalysisJob>,
    ): Promise<boolean> {
        const collection = this.connection?.collection('analysis_jobs');
        if (!collection) {
            throw new Error('Database not connected');
        }

        const result = await collection.updateOne(
            { jobId, status: expectedStatus },
            { $set: { ...updates, updatedAt: new Date().toISOString() } },
        );

        return result.matchedCount > 0;
    }
}
