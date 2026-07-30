/**
 * Thin API client.
 *
 * Server components fetch with `cache: "no-store"` — every surface here shows
 * approval state or scores, and a stale render of "0 drafts awaiting review" is
 * worse than a slower one.
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

export async function apiGet<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  // 404 is a normal state on most of these routes — "no roadmap yet" is a
  // screen we render, not an error we throw.
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(`GET ${path} failed`, res.status);
  return (await res.json()) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new ApiError(detail || `POST ${path} failed`, res.status);
  }
  return (await res.json()) as T;
}
