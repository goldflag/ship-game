import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
export function makeAuth(database: Pool, baseURL: string, secret: string) {
  return betterAuth({
    database, baseURL, secret, trustedOrigins: [baseURL],
    emailAndPassword: { enabled: true, requireEmailVerification: false, autoSignIn: true, minPasswordLength: 8 },
    session: { cookieCache: { enabled: false } },
    advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] }, database: { generateId: () => crypto.randomUUID() } },
    rateLimit: { enabled: true, window: 60, max: 60 },
  });
}
export type Auth = ReturnType<typeof makeAuth>;
