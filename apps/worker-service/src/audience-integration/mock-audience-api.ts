/**
 * Mock Third-Party Audience API Server
 *
 * Simulates an authenticated audience analytics API (similar to Upfluence/HypeAuditor).
 * Requires Bearer Token authentication and returns nested JSON responses.
 */

import http from 'http';

const PORT = 3001;

interface AudienceResponse {
    status: string;
    data?: {
        audience?: {
            gender?: Array<{ label: string; value: number }>;
            age?: Array<{ label: string; value: number }>;
            geography?: {
                countries?: Array<{ name: string; code: string; percentage: number }>;
            };
        };
        meta?: {
            media_id: string;
            platform: string;
            last_updated: string;
        };
    };
    error?: string;
}

const server = http.createServer((req, res) => {
    const authHeader = req.headers['authorization'];

    // Verify authentication
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    // Simulate network latency
    setTimeout(() => {
        if (req.url?.includes('/api/v1/audience')) {
            const urlParams = new URL(req.url, `http://localhost:${PORT}`);
            const mediaType = urlParams.searchParams.get('media_type');
            const mediaId = urlParams.searchParams.get('media_id');

            // Some media IDs use the legacy API response format
            // (retained for backward compatibility with older data pipeline versions)
            if (mediaId === '12345') {
                const legacyResponse = {
                    status: 'success',
                    audience_data: {
                        demographics: {
                            gender: [
                                { label: 'male', value: 0.45 },
                                { label: 'female', value: 0.55 },
                            ],
                        },
                    },
                };
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(legacyResponse));
                return;
            }

            // Standard response format
            const response: AudienceResponse = {
                status: 'success',
                data: {
                    audience: {
                        gender: [
                            { label: 'male', value: 0.42 },
                            { label: 'female', value: 0.58 },
                        ],
                        age: [
                            { label: '18-24', value: 0.35 },
                            { label: '25-34', value: 0.45 },
                            { label: '35-44', value: 0.15 },
                            { label: '45+', value: 0.05 },
                        ],
                        geography: {
                            countries: [
                                { name: 'United States', code: 'US', percentage: 45.5 },
                                { name: 'Canada', code: 'CA', percentage: 25.3 },
                                { name: 'United Kingdom', code: 'GB', percentage: 15.2 },
                            ],
                        },
                    },
                    meta: {
                        media_id: mediaId || 'unknown',
                        platform: mediaType || 'unknown',
                        last_updated: new Date().toISOString(),
                    },
                },
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
        } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    }, 300);
});

export function startMockAudienceServer(): Promise<void> {
    return new Promise((resolve) => {
        server.listen(PORT, () => {
            console.log(`[MockAudienceAPI] Running on http://localhost:${PORT}`);
            resolve();
        });
    });
}

// Auto-start
if (require.main === module) {
    startMockAudienceServer();
}
