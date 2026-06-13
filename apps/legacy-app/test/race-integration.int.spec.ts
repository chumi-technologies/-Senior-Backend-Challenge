import mongoose from 'mongoose';
import { AnalysisService } from '../src/analysis/analysis.service';
import { DatabaseService } from '../src/shared/database/database.service';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/analysis_db';
const TEST_USER = 'race-int-user';

/**
 * REAL-Mongo integration test for ticket #4521 — cross-process lost update.
 *
 * Two writers hit the same `analysis_jobs` document:
 *   - request path: AnalysisService.createAnalysis -> DatabaseService.saveJob (PENDING + random placeholder, confidence 0.3)
 *   - worker path : AnalysisProcessor.updateJobWithResults -> COMPLETED + real demographics (confidence 0.85)
 *
 * Before the fix, createAnalysis scheduled setTimeout(2000) that re-wrote the stale
 * placeholder, clobbering the worker's COMPLETED result. After the fix there is no
 * second writer from the request path, so the worker result survives. This test waits
 * past the old 2000ms window and asserts the worker write is intact.
 *
 * Requires Mongo (docker compose up -d mongodb). Run via: pnpm --filter legacy-app test:integration
 */
describe('Lost-update race (REAL Mongo integration) — #4521', () => {
    let available = false;

    beforeAll(async () => {
        try {
            await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 2000 });
            available = true;
        } catch {
            available = false;
        }
    });

    afterAll(async () => {
        if (available) {
            await mongoose.connection.collection('analysis_jobs').deleteMany({ userId: TEST_USER });
            await mongoose.disconnect();
        }
    });

    it('worker COMPLETED result survives past the old 2000ms overwrite window', async () => {
        if (!available) {
            throw new Error(`Mongo not reachable on ${MONGODB_URI}. Start it with: docker compose up -d mongodb`);
        }

        const db = new DatabaseService();
        await db.onModuleInit();
        const mq = { publishEvent: async () => undefined } as any;
        const service = new AnalysisService(db, mq);

        // 1) Request path: create the job (PENDING + placeholder, confidence 0.3).
        const job = await service.createAnalysis({ userId: TEST_USER, dataUrl: 'http://data/race' } as any);
        expect(job.status).toBe('PENDING');

        // 2) Worker path (independent writer): write the real COMPLETED demographics.
        const collection = mongoose.connection.collection('analysis_jobs');
        await collection.updateOne(
            { jobId: job.jobId },
            {
                $set: {
                    status: 'COMPLETED',
                    demographics: { ageRange: '25-34', gender: 'female', location: 'US', interests: ['fashion'], confidence: 0.85 },
                    completedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                },
            },
        );

        // 3) Wait past the old delayed-overwrite window (2000ms).
        await new Promise((resolve) => setTimeout(resolve, 2500));

        // 4) The worker's COMPLETED result must still be intact (not clobbered by the 0.3 placeholder).
        const finalDoc = await collection.findOne({ jobId: job.jobId });
        expect(finalDoc?.status).toBe('COMPLETED');
        expect(finalDoc?.demographics?.confidence).toBe(0.85);
        expect(finalDoc?.demographics?.ageRange).toBe('25-34');
    });
});
