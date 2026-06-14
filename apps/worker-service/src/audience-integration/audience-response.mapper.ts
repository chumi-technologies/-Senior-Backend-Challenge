type AudiencePayload = {
    readonly gender?: unknown;
    readonly age?: unknown;
    readonly geography?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

function hasAudienceData(payload: AudiencePayload): boolean {
    return payload.gender !== undefined || payload.age !== undefined || payload.geography !== undefined;
}

function toAudiencePayload(source: Record<string, unknown>): AudiencePayload | null {
    const payload: Record<string, unknown> = {};

    if (source.gender !== undefined) {
        payload.gender = source.gender;
    }
    if (source.age !== undefined) {
        payload.age = source.age;
    }
    if (source.geography !== undefined) {
        payload.geography = source.geography;
    }

    return hasAudienceData(payload) ? payload : null;
}

export function extractAudiencePayload(response: unknown): AudiencePayload | null {
    const root = asRecord(response);
    if (!root) {
        return null;
    }

    const data = asRecord(root.data);
    const standardAudience = asRecord(data?.audience);
    if (standardAudience) {
        return toAudiencePayload(standardAudience);
    }

    const audienceData = asRecord(root.audience_data);
    const legacyDemographics = asRecord(audienceData?.demographics);
    if (legacyDemographics) {
        return toAudiencePayload(legacyDemographics);
    }

    return null;
}
