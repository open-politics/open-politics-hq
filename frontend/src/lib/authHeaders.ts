/**
 * The one place a request says who it is.
 *
 * Standard `Authorization: Bearer`, so curl, the generated client, Swagger and
 * any external API consumer all authenticate the same way.
 *
 * A hardened deployment can sit behind a proxy that gates paths with HTTP Basic.
 * There is only one `Authorization` header, so that proxy must exempt the API
 * path rather than have the app move its token elsewhere — see
 * `docs/internal/SURFACE_INVENTORY.md`. Keeping the scheme standard is worth
 * more than working around one proxy config.
 *
 * This exists because the choice was previously spelled out at 41 call sites
 * across 21 files: changing how a request authenticates meant changing all of
 * them, and missing one meant a request that silently disagreed with the rest.
 */

export const AUTH_HEADER = 'Authorization';

const TOKEN_KEY = 'access_token';

/** The stored token, or null. Safe on the server and with storage blocked. */
export function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Auth headers for a hand-written fetch — spread into a headers object.
 * Empty when signed out, so `{ ...authHeaders() }` is always safe.
 */
export function authHeaders(token?: string | null): Record<string, string> {
  const t = token ?? readToken();
  return t ? { [AUTH_HEADER]: `Bearer ${t}` } : {};
}
