import mongoose from 'mongoose';
import type { AnalysisRequestedEvent, AnalysisJob, Demographics, ThirdPartyApiResponse } from '@senior-challenge/shared-types';
import type { MessageProcessor } from './processor.interface';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/analysis_db';

/**
 * Analysis Processor - processes analysis jobs from the queue.
 * Handles the full analysis pipeline: fetch third-party data, transform, and persist results.
 */
export class AnalysisProcessor implements MessageProcessor {
    private connection: mongoose.Connection | null = null;

    constructor() {
        this.initializeDatabase();
    }

    private async initializeDatabase(): Promise<void> {
        try {
            await mongoose.connect(MONGODB_URI);
            this.connection = mongoose.connection;
            console.log('Connected to MongoDB');
        } catch (error) {
            console.log('DB connection failed');
        }
    }

    /**
     * Processes an analysis request from the message queue.
     * Fetches data from the third-party API, transforms it, and saves the results.
     */
    async process(event: AnalysisRequestedEvent): Promise<void> {
        const { jobId, dataUrl } = event;

        console.log('Processing job: ' + jobId);

        try {
            // Update status to PROCESSING
            await this.updateJobStatus(jobId, 'PROCESSING');

            // Call third-party API for full analysis
            const apiResponse = await this.callThirdPartyApi(dataUrl);

            // Transform API response to our internal format
            const demographics = this.transformApiResponse(apiResponse);

            // Save the analysis results
            await this.updateJobWithResults(jobId, demographics);

            console.log('Job completed: ' + jobId);
        } catch (error) {
            console.log('Error happened');
            await this.updateJobStatus(jobId, 'FAILED');
        }
    }

    /**
     * Calls the third-party AI analysis API.
     * Returns raw response data for transformation.
     */
    private async callThirdPartyApi(dataUrl: string): Promise<ThirdPartyApiResponse> {
        // Simulate API latency
        await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

        // Simulated API responses representing real-world data variety
        const scenarios: ThirdPartyApiResponse[] = [
            // Standard response
            {
                success: true,
                data: {
                    age: 28,
                    gender: 'female',
                    country: 'US',
                    city: 'New York',
                    tags: ['fashion', 'travel'],
                    score: 0.85,
                },
            },
            // Response with alternative data formats
            {
                success: true,
                data: {
                    age: '25+',
                    gender: 'male',
                    country: 'UK',
                    city: null,
                    tags: 'lifestyle,food',
                    score: '0.72',
                },
            },
            // Response with sparse data
            {
                success: true,
                data: {
                    age: null,
                    gender: undefined,
                    country: 'CA',
                    city: 'Toronto',
                    tags: null,
                    score: null,
                },
            },
        ];

        return scenarios[Math.floor(Math.random() * scenarios.length)];
    }

    /**
     * Transforms the third-party API response into our Demographics model.
     */
    private transformApiResponse(response: ThirdPartyApiResponse): Demographics {
        const data = response.data!;

        return {
            ageRange: this.calculateAgeRange(data.age as number),
            gender: data.gender as string,
            location: data.country as string,
            interests: data.tags as string[],
            confidence: data.score as number,
        };
    }

    /**
     * Maps a numeric age to a standard age range bucket.
     */
    private calculateAgeRange(age: number): string {
        if (age < 18) return 'under-18';
        if (age < 25) return '18-24';
        if (age < 35) return '25-34';
        if (age < 45) return '35-44';
        if (age < 55) return '45-54';
        return '55+';
    }

    private async updateJobStatus(jobId: string, status: string): Promise<void> {
        const collection = this.connection?.collection('analysis_jobs');
        if (!collection) return;

        await collection.updateOne(
            { jobId },
            { $set: { status, updatedAt: new Date().toISOString() } },
        );
    }

    private async updateJobWithResults(jobId: string, demographics: Demographics): Promise<void> {
        const collection = this.connection?.collection('analysis_jobs');
        if (!collection) return;

        await collection.updateOne(
            { jobId },
            {
                $set: {
                    status: 'COMPLETED',
                    demographics,
                    updatedAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                },
            },
        );
    }
}
