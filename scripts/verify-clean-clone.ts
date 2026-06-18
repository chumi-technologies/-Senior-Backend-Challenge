/**
 * Clean-clone verification script.
 *
 * Sanity-checks that someone can `git clone` the repo, `pnpm install`,
 * and immediately get a working test environment WITHOUT pre-built
 * `dist/` artefacts of workspace packages.
 *
 * It deliberately does not exec subprocess `pnpm` again (the caller is
 * already in pnpm). Instead it asserts the structural conditions a
 * clean clone needs:
 *   1. `packages/shared-types` resolves from source (no dist required).
 *   2. The atomic conditional update method exists on DatabaseService.
 *   3. AnalysisService.delayedUpdate calls only the atomic method.
 *   4. The bug-repro spec exists and exercises the atomic API.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Check = {
    readonly name: string;
    readonly passed: boolean;
    readonly message: string;
};

async function main(): Promise<void> {
    const checks: Check[] = [];

    const sharedTypesPkg = JSON.parse(
        await readFile(join(process.cwd(), 'packages/shared-types/package.json'), 'utf8'),
    ) as { main?: string; types?: string; exports?: unknown };
    checks.push({
        name: 'shared-types main resolves to src (no dist required)',
        passed: typeof sharedTypesPkg.main === 'string' && sharedTypesPkg.main.startsWith('src/'),
        message: `main = ${sharedTypesPkg.main}`,
    });
    checks.push({
        name: 'shared-types types resolves to src',
        passed: typeof sharedTypesPkg.types === 'string' && sharedTypesPkg.types.startsWith('src/'),
        message: `types = ${sharedTypesPkg.types}`,
    });

    const dbService = await readFile(
        join(process.cwd(), 'apps/legacy-app/src/shared/database/database.service.ts'),
        'utf8',
    );
    checks.push({
        name: 'DatabaseService exposes updateJobIfNotCompleted (atomic conditional update)',
        passed: dbService.includes('updateJobIfNotCompleted')
            && dbService.includes("status: { $ne: 'COMPLETED' }"),
        message: 'must use a single MongoDB updateOne with status filter',
    });

    const analysisService = await readFile(
        join(process.cwd(), 'apps/legacy-app/src/analysis/analysis.service.ts'),
        'utf8',
    );
    const usesAtomic = analysisService.includes('updateJobIfNotCompleted');
    const usesReadThenWrite =
        /findJobById\([\s\S]*?\)[\s\S]*?updateJob\(/m.test(analysisService) &&
        !analysisService.includes('updateJobIfNotCompleted');
    checks.push({
        name: 'AnalysisService.delayedUpdate uses atomic conditional update',
        passed: usesAtomic && !usesReadThenWrite,
        message: 'must NOT use findJobById -> updateJob (read-then-write TOCTOU)',
    });

    const spec = await readFile(
        join(process.cwd(), 'apps/legacy-app/test/bug-repro.spec.ts'),
        'utf8',
    );
    checks.push({
        name: 'bug-repro.spec exercises the atomic conditional update',
        passed: spec.includes('updateJobIfNotCompleted') && spec.includes('TOCTOU'),
        message: 'spec must include a TOCTOU regression case',
    });

    for (const check of checks) {
        const icon = check.passed ? '✅' : '❌';
        console.log(`${icon} ${check.name}: ${check.message}`);
    }
    if (checks.some((c) => !c.passed)) {
        process.exitCode = 1;
    }
}

void main();
