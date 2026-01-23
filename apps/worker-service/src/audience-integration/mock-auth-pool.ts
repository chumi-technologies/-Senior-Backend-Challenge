/**
 * 模拟 Auth Pool Manager (基于 Redis 的认证池)
 * 
 * 真实场景中的问题：
 * - 多个并发请求可能重用同一个auth导致429
 * - Auth 过期时间管理不当
 * - 没有正确的 fallback机制
 */

interface AuthConfig {
    username: string;
    password: string;
}

export class MockAuthPool {
    private authPool: AuthConfig[] = [
        { username: 'slave1@test.com', password: 'pass1' },
        { username: 'slave2@test.com', password: 'pass2' },
        { username: 'slave3@test.com', password: 'pass3' },
    ];

    private authIndex = 0;
    private lastUsage: Map<string, number> = new Map();
    private readonly MIN_INTERVAL = 200; // ms

    /**
     * 获取下一个可用的认证
     * 
     * 🐛 BUG本 #1: 没有检查并发使用，可能导致同一个 auth 被多次使用
     */
    async getNextAuth(): Promise<AuthConfig> {
        const auth = this.authPool[this.authIndex];
        this.authIndex = (this.authIndex + 1) % this.authPool.length;

        // 🐛 BUG: 应该检查 lastUsage[auth.username]，但这里忘了
        // const lastUse = this.lastUsage.get(auth.username) || 0;
        // const now = Date.now();
        // if (now - lastUse < this.MIN_INTERVAL) {
        //   await new Promise(resolve => setTimeout(resolve, this.MIN_INTERVAL));
        // }

        this.lastUsage.set(auth.username, Date.now());
        return auth;
    }

    /**
     * 获取 token
     * 
     * 🐛 BUG #2: 没有实现 token 缓存，每次都重新获取
     */
    async getToken(auth: AuthConfig): Promise<string> {
        // 模拟 token 获取延迟
        await new Promise(resolve => setTimeout(resolve, 50));

        // 简单hash作为token
        const token = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        return token;
    }
}
