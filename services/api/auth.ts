import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { Pool } from 'pg';
import { allowsOrigin } from './origins';
export function makeAuth(database: Pool, baseURL: string, secret: string) {
  return betterAuth({
    database, baseURL, secret,
    trustedOrigins: request => {
      const origin = request?.headers.get('origin');
      return origin && allowsOrigin(baseURL, origin) ? [baseURL, origin] : [baseURL];
    },
    emailAndPassword: { enabled: true, requireEmailVerification: false, autoSignIn: true, minPasswordLength: 8 },
    session: { cookieCache: { enabled: false } },
    // Keep origin checks enabled in integration tests as well as development/production.
    advanced: { disableOriginCheck: false, ipAddress: { ipAddressHeaders: ['x-forwarded-for'] }, database: { generateId: () => crypto.randomUUID() } },
    rateLimit: { enabled: true, window: 60, max: 60 },
    // Roles, bans and user listing for the admin page (/admin). Promote an account by setting auth."user".role to 'admin'.
    plugins: [admin()],
  });
}
export type Auth = ReturnType<typeof makeAuth>;
