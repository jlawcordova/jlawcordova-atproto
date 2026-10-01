import { AtpAgent, type AtpSessionData } from "@atproto/api";
import type { Env } from "./env.js";
import { log } from "./log.js";

const SESSION_KEY = "atproto:session:v1";
const IDENTITY_KEY = "atproto:identity:v1";
const IDENTITY_TTL_SECONDS = 3600;

/** Any PDS or AppView can resolve a handle; this one is public and unauthenticated. */
const HANDLE_RESOLVER = "https://public.api.bsky.app";

export interface Identity {
  handle: string;
  did: string;
  pds: string;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${new URL(url).host}${new URL(url).pathname} returned ${res.status}`);
  return res.json();
}

async function resolveIdentityUncached(handle: string): Promise<Identity> {
  const resolved = (await getJson(
    `${HANDLE_RESOLVER}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
  )) as { did?: unknown };
  const did = resolved.did;
  if (typeof did !== "string" || !/^did:(plc|web):[A-Za-z0-9._:%-]+$/.test(did)) {
    throw new Error("handle did not resolve to a DID");
  }

  let docUrl: string;
  if (did.startsWith("did:plc:")) docUrl = `https://plc.directory/${did}`;
  else docUrl = `https://${decodeURIComponent(did.slice("did:web:".length))}/.well-known/did.json`;

  const doc = (await getJson(docUrl)) as {
    service?: { id?: string; type?: string; serviceEndpoint?: unknown }[];
  };
  const service = doc.service?.find(
    (s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer",
  );
  const endpoint = service?.serviceEndpoint;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
    throw new Error("DID document has no https #atproto_pds endpoint");
  }
  return { handle, did, pds: endpoint.replace(/\/+$/, "") };
}

/** Handle → DID → PDS endpoint, cached in KV for an hour. Nothing is hardcoded. */
export async function resolveIdentity(env: Env): Promise<Identity> {
  const cached = await env.OAUTH_KV.get<Identity>(IDENTITY_KEY, "json");
  if (cached && cached.handle === env.ATPROTO_HANDLE) return cached;
  const identity = await resolveIdentityUncached(env.ATPROTO_HANDLE);
  await env.OAUTH_KV.put(IDENTITY_KEY, JSON.stringify(identity), { expirationTtl: IDENTITY_TTL_SECONDS });
  return identity;
}

export interface PdsSession {
  agent: AtpAgent;
  identity: Identity;
}

function isAuthFailure(error: unknown): boolean {
  const e = error as { status?: number; error?: string } | null;
  return (
    e?.status === 401 ||
    e?.error === "ExpiredToken" ||
    e?.error === "InvalidToken" ||
    e?.error === "AuthenticationRequired"
  );
}

/**
 * Signs in to the PDS, reusing the stored session when there is one.
 *
 * Refresh, don't log in: an expired access token is refreshed by the agent with
 * the stored refresh token. `createSession` (rate-limited) is used only when
 * there is no stored session, or the PDS rejects it and the refresh fails
 * (see `withPds`).
 */
async function openSession(env: Env, identity: Identity, pending: Promise<unknown>[]): Promise<AtpAgent> {
  const agent = new AtpAgent({
    service: identity.pds,
    persistSession: (evt, session) => {
      if (evt === "create" || evt === "update") {
        if (session) pending.push(env.OAUTH_KV.put(SESSION_KEY, JSON.stringify(session)));
      } else if (evt === "expired") {
        pending.push(env.OAUTH_KV.delete(SESSION_KEY));
      }
    },
  });

  // Reuse the stored session as is. `agent.resumeSession()` would force a
  // refresh on every request; instead the agent refreshes only when the PDS
  // reports the access token expired, and persists the result.
  const stored = await env.OAUTH_KV.get<AtpSessionData>(SESSION_KEY, "json");
  if (stored?.did === identity.did) {
    agent.sessionManager.session = stored;
  } else {
    await agent.login({ identifier: env.BSKY_IDENTIFIER, password: env.BSKY_APP_PASSWORD });
    log({ event: "pds_session", outcome: "login" });
  }

  // A mismatch is an error, not a write to some other account.
  if (agent.session?.did !== identity.did) {
    throw new Error("PDS session belongs to a different DID than the configured handle");
  }
  return agent;
}

/**
 * Runs `fn` with an authenticated agent. If the PDS rejects the session
 * mid-call (the refresh token was revoked, say), signs in once and retries.
 */
export async function withPds<T>(env: Env, fn: (s: PdsSession) => Promise<T>): Promise<T> {
  const identity = await resolveIdentity(env);
  const pending: Promise<unknown>[] = [];
  try {
    let agent = await openSession(env, identity, pending);
    try {
      return await fn({ agent, identity });
    } catch (error) {
      if (!isAuthFailure(error)) throw error;
      await Promise.allSettled(pending.splice(0));
      await env.OAUTH_KV.delete(SESSION_KEY);
      agent = await openSession(env, identity, pending);
      return await fn({ agent, identity });
    }
  } finally {
    await Promise.allSettled(pending);
  }
}

/** True for the PDS's "record doesn't exist" error. */
export function isRecordNotFound(error: unknown): boolean {
  return (error as { error?: string } | null)?.error === "RecordNotFound";
}
