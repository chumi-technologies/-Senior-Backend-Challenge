/**
 * 模拟第三方 Audience API 服务器
 * 
 * 场景：这是一个需要认证的 Upfluence 风格 API
 * - 需要 Bearer Token
 * - 返回多层嵌套的 JSON
 * - 某些情况下数据结构会变化
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

    // 检查认证
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    // 模拟延迟
    setTimeout(() => {
        if (req.url?.includes('/api/v1/audience')) {
            const urlParams = new URL(req.url, `http://localhost:${PORT}`);
            const mediaType = urlParams.searchParams.get('media_type');
            const mediaId = urlParams.searchParams.get('media_id');

            // 🐛 BUG 场景 1: 某些 media_id 返回的结构不一样
            if (mediaId === '12345') {
                // 这是一个"老"的数据结构（已弃用），但API偶尔还会返回
                const legacyResponse = {
                    status: 'success',
                    audience_data: {  // 注意：不是 data.audience，而是 audience_data 
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

            // 正常响应
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
    }, 300); // 300ms 延迟模拟网络
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
