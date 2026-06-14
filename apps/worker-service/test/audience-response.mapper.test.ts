import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAudiencePayload } from '../src/audience-integration/audience-response.mapper';

test('extracts the standard third-party audience response format', () => {
    const payload = extractAudiencePayload({
        status: 'success',
        data: {
            audience: {
                gender: [{ label: 'female', value: 0.58 }],
                age: [{ label: '25-34', value: 0.45 }],
                geography: {
                    countries: [{ name: 'United States', code: 'US', percentage: 45.5 }],
                },
            },
        },
    });

    assert.deepEqual(payload, {
        gender: [{ label: 'female', value: 0.58 }],
        age: [{ label: '25-34', value: 0.45 }],
        geography: {
            countries: [{ name: 'United States', code: 'US', percentage: 45.5 }],
        },
    });
});

test('extracts the legacy third-party audience response format', () => {
    const payload = extractAudiencePayload({
        status: 'success',
        audience_data: {
            demographics: {
                gender: [
                    { label: 'male', value: 0.45 },
                    { label: 'female', value: 0.55 },
                ],
            },
        },
    });

    assert.deepEqual(payload, {
        gender: [
            { label: 'male', value: 0.45 },
            { label: 'female', value: 0.55 },
        ],
    });
});

test('returns null when no supported audience payload exists', () => {
    assert.equal(extractAudiencePayload({ status: 'success', data: {} }), null);
    assert.equal(extractAudiencePayload(null), null);
});
