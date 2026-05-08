import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface LaunchContext {
  /** Phase 2 workspace id. Populated by Phase 2 daemons; absent on legacy launches. */
  workspaceId?: string;
  fleetRoot: string;
  role: string;
  sessionId: string;
  daemonUrl: string;
  /** Mutable: starts as one-time bootstrap token, then becomes session credential after validateLaunchContext(). */
  launchToken: string;
  sessionCredentialExpiresAt?: string;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function getLaunchContext(env: Record<string, string | undefined> = process.env): LaunchContext | null {
  if (env.WHATSAGENT_ENABLED !== "1") return null;
  const workspaceId = env.WHATSAGENT_WORKSPACE_ID;
  const fleetRoot = env.WHATSAGENT_FLEET_ROOT ?? env.WHATSAGENT_WORKSPACE_PATH;
  const role = env.WHATSAGENT_ROLE;
  const sessionId = env.WHATSAGENT_SESSION_ID;
  const daemonUrl = env.WHATSAGENT_DAEMON_URL;
  const launchToken = env.WHATSAGENT_LAUNCH_TOKEN;
  if (!fleetRoot || !role || !sessionId || !daemonUrl || !launchToken) return null;
  return { workspaceId, fleetRoot, role, sessionId, daemonUrl, launchToken };
}

export function requireLaunchContext(env: Record<string, string | undefined> = process.env): LaunchContext {
  const context = getLaunchContext(env);
  if (!context) {
    throw new Error("WhatsAgent integration is disabled: this agent was not launched by WhatsAgent.");
  }
  if (!isLoopbackDaemonUrl(context.daemonUrl)) {
    // Defence against an untrusted shell/dev container overwriting WHATSAGENT_DAEMON_URL
    // and tricking the MCP child into leaking its launch token to a remote host.
    throw new Error(`WhatsAgent daemon URL must point at loopback (127.0.0.1, localhost, or ::1); got ${context.daemonUrl}`);
  }
  return context;
}

// `new URL("http://[::1]")` exposes the IPv6 hostname as "[::1]" (with brackets,
// per WHATWG URL); accept both forms so the brackets don't trip the check.
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackDaemonUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return LOOPBACK_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

export function createLaunchToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashLaunchToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function launchTokenHashMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashLaunchToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function validateLaunchContext(context: LaunchContext, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const tokenBeforeExchange = context.launchToken;
  const res = await fetchImpl(`${context.daemonUrl}/api/v1/launch-token/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${context.launchToken}` },
    body: JSON.stringify({ workspaceId: context.workspaceId, role: context.role, sessionId: context.sessionId }),
  });
  if (!res.ok) return false;
  const body = await res.json().catch(() => ({})) as { ok?: boolean; sessionCredential?: string; sessionCredentialExpiresAt?: string };
  if (body.ok !== true) return false;
  if (typeof body.sessionCredential === "string" && body.sessionCredential.length > 0) {
    context.launchToken = body.sessionCredential;
    if (typeof body.sessionCredentialExpiresAt === "string") context.sessionCredentialExpiresAt = body.sessionCredentialExpiresAt;
    // WA-154: the raw bootstrap token is model-adjacent while it remains in
    // process.env. Clear it immediately after the daemon exchanges it for the
    // short-lived session credential held only in this LaunchContext object.
    if (process.env.WHATSAGENT_SESSION_ID === context.sessionId && process.env.WHATSAGENT_LAUNCH_TOKEN === tokenBeforeExchange) {
      process.env.WHATSAGENT_LAUNCH_TOKEN = "";
    }
  }
  return true;
}
