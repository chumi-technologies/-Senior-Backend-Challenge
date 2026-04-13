/**
 * Analysis Job status enum.
 */
export type AnalysisStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

/**
 * Channel type for notification delivery.
 */
export type NotificationChannel = 'EMAIL' | 'SMS' | 'PUSH';

/**
 * Demographics data structure.
 * Represents audience demographic analysis results.
 */
export interface Demographics {
    ageRange?: string;
    gender?: string;
    location?: string;
    interests?: string[];
    confidence?: number;
}

/**
 * Analysis Job entity.
 */
export interface AnalysisJob {
    jobId: string;
    userId: string;
    dataUrl: string;
    status: AnalysisStatus;
    demographics?: Demographics;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    error?: string;
    version?: number;
}

/**
 * Create Analysis Request DTO.
 */
export interface CreateAnalysisRequest {
    userId: string;
    dataUrl: string;
}

/**
 * Analysis Requested Event - published to the message queue.
 */
export interface AnalysisRequestedEvent {
    eventType: 'AnalysisRequested';
    jobId: string;
    userId: string;
    dataUrl: string;
    timestamp: string;
    traceId?: string;
}

/**
 * Third-party API raw response.
 * Format may vary between API versions and providers.
 */
export interface ThirdPartyApiResponse {
    success: boolean;
    data?: {
        age?: number | string | null;
        gender?: string | null;
        country?: string | null;
        city?: string | null;
        tags?: string[] | string | null;
        score?: number | string | null;
    };
    error?: string;
}
