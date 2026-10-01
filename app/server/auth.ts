import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins/username";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema";

export type AppEnv = Env & {
  BETTER_AUTH_SECRET?: string;
  BOOTSTRAP_SECRET?: string;
  APP_ORIGIN?: string;
  APP_PUBLIC_ORIGIN?: string;
};

export function createAuth(env: AppEnv, request: Request) {
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error("AUTH_NOT_CONFIGURED");
  }
  const origin = env.APP_ORIGIN || new URL(request.url).origin;
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: origin,
    basePath: "/api/auth",
    trustedOrigins: [origin],
    database: drizzleAdapter(drizzle(env.DB, { schema }), { provider: "sqlite", schema, transaction: false }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128 },
    plugins: [username({ minUsernameLength: 3, maxUsernameLength: 30, immutableUsername: true })],
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "member", input: false },
        bio: { type: "string", defaultValue: "", input: false },
      },
    },
    databaseHooks: {
      session: { create: { before: async (session) => {
        const account = await env.DB.prepare("SELECT disabled FROM user WHERE id=?").bind(session.userId).first<{ disabled: number }>();
        return account && !account.disabled ? { data: session } : false;
      } } },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: origin.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    },
    // Persistent D1 throttling is applied by the API router, also in local dev.
    rateLimit: { enabled: false },
  });
}

export type Member = { id: string; name: string; username: string; role: "admin" | "member"; bio: string };
export async function readMember(env: AppEnv, request: Request): Promise<Member | null> {
  const session = await createAuth(env, request).api.getSession({ headers: request.headers });
  if (!session) return null;
  // Always retrieve current server authority; never accept a role from the client.
  return env.DB.prepare("SELECT id,name,username,role,bio FROM user WHERE id=? AND disabled=0").bind(session.user.id).first<Member>();
}
