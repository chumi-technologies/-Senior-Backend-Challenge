/**
 * Auth Pool Manager - manages authentication credentials for API access.
 * Rotates through available auth slots to distribute API rate limits.
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
     * Returns the next available authentication credential via round-robin.
     */
    async getNextAuth(): Promise<AuthConfig> {
        const auth = this.authPool[this.authIndex];
        this.authIndex = (this.authIndex + 1) % this.authPool.length;
        this.lastUsage.set(auth.username, Date.now());
        return auth;
    }

    /**
     * Generates a bearer token for the given auth credentials.
     */
    async getToken(auth: AuthConfig): Promise<string> {
        // Simulate token acquisition latency
        await new Promise(resolve => setTimeout(resolve, 50));
        const token = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        return token;
    }
}
