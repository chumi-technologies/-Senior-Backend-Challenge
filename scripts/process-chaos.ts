/**
 * Process Chaos Data Script
 *
 * Processes the third-party API response samples in debug-payloads/chaos-data-samples.json.
 *
 * Expected output format:
 *   ✅ Processed: X records
 *   ⚠️ Skipped (validation failed): Y records
 *   📁 Failed records saved to: failed-records/batch-xxx.json
 *
 * Usage: pnpm run process:chaos
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

type Classification = 'valid' | 'normalized' | 'degraded' | 'rejected';

interface ValidationIssue {
    field: string;
    value: unknown;
    reason: string;
}

interface NormalizedRecord {
    id: string;
    ageRange: string;
    gender: string;
    country: string;
    city?: string;
    tags: string[];
    engagementScore?: number;
    email: string;
}

interface ProcessedRecord {
    id: string;
    classification: Exclude<Classification, 'rejected'>;
    normalized: NormalizedRecord;
    warnings: ValidationIssue[];
}

interface FailedRecord {
    id?: string;
    classification: 'rejected';
    reasons: ValidationIssue[];
    raw: unknown;
}

const INPUT_FILE = process.env.CHAOS_INPUT_FILE
    ? path.resolve(process.cwd(), process.env.CHAOS_INPUT_FILE)
    : path.join(process.cwd(), 'debug-payloads', 'chaos-data-samples.json');
const FAILED_RECORDS_DIR = process.env.FAILED_RECORDS_DIR
    ? path.resolve(process.cwd(), process.env.FAILED_RECORDS_DIR)
    : path.join(process.cwd(), 'failed-records');
const CANONICAL_AGE_RANGES = new Set(['under-18', '18-24', '25-34', '35-44', '45-54', '55+']);

const RawChaosRecordSchema = z.object({
    id: z.string(),
    age: z.union([z.number(), z.string()]).nullable().optional(),
    gender: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    tags: z.union([z.array(z.string()), z.string()]).nullable().optional(),
    engagementScore: z.union([z.number(), z.string()]).nullable().optional(),
    email: z.string().nullable().optional(),
});

type RawChaosRecord = z.infer<typeof RawChaosRecordSchema>;

async function main(): Promise<void> {
    const records = loadRecords(INPUT_FILE);
    const processed: ProcessedRecord[] = [];
    const failed: FailedRecord[] = [];

    for (const raw of records) {
        const parsed = parseRawRecord(raw);
        if (parsed.classification === 'rejected') {
            failed.push(parsed);
            logEvent('warn', 'chaos_record_validation_failed', {
                recordId: parsed.id ?? 'unknown',
                reasons: parsed.reasons,
            });
            continue;
        }

        const result = processRecord(parsed);

        if (result.classification === 'rejected') {
            failed.push(result);
            logEvent('warn', 'chaos_record_validation_failed', {
                recordId: result.id ?? 'unknown',
                reasons: result.reasons,
            });
            continue;
        }

        processed.push(result);
        logEvent('info', 'chaos_record_processed', {
            recordId: result.id,
            classification: result.classification,
            warningCount: result.warnings.length,
        });
    }

    const failedPath = writeFailedRecords(failed);

    const byClassification = countByClassification(processed, failed);
    console.log(`✅ Processed: ${processed.length} records`);
    console.log(`   Valid: ${byClassification.valid}`);
    console.log(`   Normalized: ${byClassification.normalized}`);
    console.log(`   Degraded: ${byClassification.degraded}`);
    console.log(`⚠️ Skipped (validation failed): ${failed.length} records`);
    console.log(`📁 Failed records saved to: ${failedPath}`);
}

function loadRecords(filepath: string): unknown[] {
    const rawContent = fs.readFileSync(filepath, 'utf-8');
    const parsed = JSON.parse(rawContent) as unknown;

    if (!Array.isArray(parsed)) {
        throw new Error('Invalid chaos data file shape: root value must be an array');
    }

    return parsed;
}

function parseRawRecord(raw: unknown): RawChaosRecord | FailedRecord {
    const result = RawChaosRecordSchema.safeParse(raw);
    if (result.success) {
        return result.data;
    }

    return {
        id: extractRecordId(raw),
        classification: 'rejected',
        reasons: result.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'record',
            value: undefined,
            reason: issue.message,
        })),
        raw,
    };
}

function processRecord(raw: RawChaosRecord): ProcessedRecord | FailedRecord {
    const reasons: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    let changed = false;

    const age = normalizeAge(raw.age);
    if (!age.ok) {
        reasons.push(age.issue);
    } else {
        changed = changed || age.changed;
        if (age.warning) {
            warnings.push(age.warning);
        }
    }

    const gender = normalizeGender(raw.gender);
    if (!gender.ok) {
        reasons.push(gender.issue);
    }

    const country = normalizeRequiredString('country', raw.country);
    if (!country.ok) {
        reasons.push(country.issue);
    }

    const tags = normalizeTags(raw.tags);
    if (!tags.ok) {
        warnings.push(tags.issue);
        changed = true;
    } else {
        changed = changed || tags.changed;
    }

    const score = normalizeEngagementScore(raw.engagementScore);
    if (!score.ok) {
        warnings.push(score.issue);
        changed = true;
    } else {
        changed = changed || score.changed;
    }

    const email = normalizeEmail(raw.email);
    if (!email.ok) {
        reasons.push(email.issue);
    }

    const hasCoreDemographics = age.ok && gender.ok && country.ok;
    if (!hasCoreDemographics || reasons.length > 0) {
        return {
            id: raw.id,
            classification: 'rejected',
            reasons: [...reasons, ...warnings],
            raw,
        };
    }

    const normalized: NormalizedRecord = {
        id: raw.id,
        ageRange: age.value,
        gender: gender.value,
        country: country.value,
        city: normalizeOptionalString(raw.city),
        tags: tags.ok ? tags.value : [],
        engagementScore: score.ok ? score.value : undefined,
        email: email.value,
    };

    const classification = warnings.length > 0
        ? 'degraded'
        : changed
            ? 'normalized'
            : 'valid';

    return {
        id: raw.id,
        classification,
        normalized,
        warnings,
    };
}

function normalizeAge(value: RawChaosRecord['age']):
    | { ok: true; value: string; changed: boolean; warning?: ValidationIssue }
    | { ok: false; issue: ValidationIssue } {
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || value < 0 || value > 120) {
            return invalid('age', value, 'age must be an integer between 0 and 120');
        }

        return { ok: true, value: calculateAgeRange(value), changed: false };
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (CANONICAL_AGE_RANGES.has(trimmed)) {
            return { ok: true, value: trimmed, changed: false };
        }

        const plusMatch = trimmed.match(/^(\d{1,3})\+$/);
        if (plusMatch) {
            const lowerBound = Number(plusMatch[1]);
            if (lowerBound >= 0 && lowerBound <= 120) {
                return {
                    ok: true,
                    value: calculateAgeRange(lowerBound),
                    changed: true,
                    warning: {
                        field: 'age',
                        value,
                        reason: 'open-ended age range mapped to lower-bound canonical bucket',
                    },
                };
            }

            return invalid('age', value, 'age range lower bound must be between 0 and 120');
        }

        const rangeMatch = trimmed.match(/^(\d{1,3})-(\d{1,3})$/);
        if (rangeMatch) {
            const start = Number(rangeMatch[1]);
            const end = Number(rangeMatch[2]);
            if (start >= 0 && end <= 120 && start <= end && CANONICAL_AGE_RANGES.has(trimmed)) {
                return { ok: true, value: trimmed, changed: true };
            }

            return invalid('age', value, 'age range must be ordered, within 0 to 120, and match canonical buckets');
        }
    }

    return invalid('age', value, 'age is required and must be numeric or a parseable age range');
}

function normalizeRequiredString(field: string, value: string | null | undefined):
    | { ok: true; value: string }
    | { ok: false; issue: ValidationIssue } {
    if (typeof value !== 'string' || value.trim().length === 0) {
        return invalid(field, value, `${field} is required`);
    }

    return { ok: true, value: value.trim() };
}

function normalizeGender(value: string | null | undefined):
    | { ok: true; value: string }
    | { ok: false; issue: ValidationIssue } {
    const normalized = normalizeRequiredString('gender', value);
    if (!normalized.ok) {
        return normalized;
    }

    const allowed = new Set(['male', 'female', 'other', 'non-binary']);
    const gender = normalized.value.toLowerCase();
    if (!allowed.has(gender)) {
        return invalid('gender', value, 'gender must be male, female, other, or non-binary');
    }

    return { ok: true, value: gender };
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTags(value: RawChaosRecord['tags']):
    | { ok: true; value: string[]; changed: boolean }
    | { ok: false; issue: ValidationIssue } {
    if (Array.isArray(value)) {
        const tags = value.map((tag) => tag.trim()).filter(Boolean);
        if (tags.length === 0) {
            return invalid('tags', value, 'tags are empty; keeping record with empty interests');
        }

        return { ok: true, value: tags, changed: tags.length !== value.length };
    }

    if (typeof value === 'string') {
        const tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
        if (tags.length > 0) {
            return { ok: true, value: tags, changed: true };
        }
    }

    return invalid('tags', value, 'tags are missing or empty; keeping record with empty interests');
}

function normalizeEngagementScore(value: RawChaosRecord['engagementScore']):
    | { ok: true; value: number; changed: boolean }
    | { ok: false; issue: ValidationIssue } {
    if (typeof value === 'number') {
        if (value >= 0 && value <= 1) {
            return { ok: true, value, changed: false };
        }

        return invalid('engagementScore', value, 'engagementScore must be between 0 and 1');
    }

    if (typeof value === 'string') {
        const numeric = Number(value);
        if (!Number.isNaN(numeric) && numeric >= 0 && numeric <= 1) {
            return { ok: true, value: numeric, changed: true };
        }
    }

    return invalid(
        'engagementScore',
        value,
        'engagementScore is unavailable or non-numeric; keeping core demographics only',
    );
}

function normalizeEmail(value: RawChaosRecord['email']):
    | { ok: true; value: string }
    | { ok: false; issue: ValidationIssue } {
    if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return invalid('email', value, 'email must be a valid address');
    }

    return { ok: true, value };
}

function invalid(field: string, value: unknown, reason: string): { ok: false; issue: ValidationIssue } {
    return {
        ok: false,
        issue: { field, value, reason },
    };
}

function calculateAgeRange(age: number): string {
    if (age < 18) return 'under-18';
    if (age < 25) return '18-24';
    if (age < 35) return '25-34';
    if (age < 45) return '35-44';
    if (age < 55) return '45-54';
    return '55+';
}

function writeFailedRecords(records: FailedRecord[]): string {
    fs.mkdirSync(FAILED_RECORDS_DIR, { recursive: true });

    const filename = `batch-${new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z')}.json`;
    const filepath = path.join(FAILED_RECORDS_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(records, null, 2));
    return filepath;
}

function countByClassification(processed: ProcessedRecord[], failed: FailedRecord[]): Record<Classification, number> {
    const counts: Record<Classification, number> = {
        valid: 0,
        normalized: 0,
        degraded: 0,
        rejected: failed.length,
    };

    for (const record of processed) {
        counts[record.classification] += 1;
    }

    return counts;
}

function logEvent(level: 'info' | 'warn' | 'error', event: string, context: Record<string, unknown>): void {
    console.log(JSON.stringify({
        level,
        event,
        timestamp: new Date().toISOString(),
        ...context,
    }));
}

function extractRecordId(raw: unknown): string | undefined {
    if (!raw || typeof raw !== 'object') {
        return undefined;
    }

    const maybeId = (raw as { id?: unknown }).id;
    return typeof maybeId === 'string' ? maybeId : undefined;
}

main().catch((error) => {
    logEvent('error', 'chaos_processing_failed', {
        message: (error as Error).message,
    });
    process.exitCode = 1;
});
