/**
 * Thin API client.
 *
 * Server components fetch with `cache: "no-store"` — every surface here shows
 * approval state or scores, and a stale render of "0 drafts awaiting review" is
 * worse than a slower one.
 *
 * Identity travels in the session cookie, never in the URL. That is the whole
 * point of the change: `?userId=` in a path meant the address bar was the
 * authentication, so it leaked through history, referrers and shared links, and
 * editing it read somebody else's account.
 *
 * The browser sends the cookie itself with `credentials: "include"`. A server
 * component has no ambient cookie jar, so it has to forward the one on the
 * incoming request explicitly.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Thrown when the caller is not signed in — pages turn this into a redirect. */
export class NotSignedInError extends ApiError {
  constructor() {
    super("Not signed in.", 401);
  }
}

async function serverCookieHeader(): Promise<string | undefined> {
  // Imported lazily so this module stays usable from client components, where
  // next/headers throws.
  if (typeof window !== "undefined") return undefined;
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const all = jar.getAll();
  if (all.length === 0) return undefined;
  return all.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const cookie = await serverCookieHeader();
  return fetch(`${API_URL}${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers: {
      ...init.headers,
      ...(cookie ? { cookie } : {}),
    },
  });
}

export async function apiGet<T>(path: string): Promise<T | null> {
  const res = await request(path, { method: "GET" });
  if (res.status === 401) throw new NotSignedInError();
  // 404 is a normal state on most of these routes — "no roadmap yet" is a
  // screen we render, not an error we throw.
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(`GET ${path} failed`, res.status);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await request(path, {
    method: "POST",
    // Declaring JSON with no body is rejected by Fastify before the route runs.
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new NotSignedInError();
  if (!res.ok) {
    const detail = await res.text();
    throw new ApiError(detail || `POST ${path} failed`, res.status);
  }
  return (await res.json()) as T;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  linkedinAccount: { name: string | null; scopes: string; connectedAt: string } | null;
}

/** The signed-in user, or null. Never throws — callers decide what to render. */
export async function currentUser(): Promise<SessionUser | null> {
  try {
    const me = await apiGet<{ user: SessionUser }>("/auth/me");
    return me?.user ?? null;
  } catch {
    return null;
  }
}
