import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing and session tokens — the front door for multi-user access.
 *
 * scrypt from node:crypto rather than argon2 or bcrypt: both of those are native
 * addons, and a password hash that fails to build on someone's machine is a
 * worse outcome than the modest margin argon2id would buy. scrypt is memory-hard
 * and in the standard library.
 *
 * Parameters are stored in the hash string, so raising the cost later does not
 * invalidate existing passwords — `needsRehash` reports when a stored hash was
 * made with weaker settings, and the login path upgrades it.
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP's floor for scrypt at the time of writing. */
export const SCRYPT_PARAMS = { N: 2 ** 16, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
// scrypt's default maxmem (32MB) is below what N=2^16, r=8 needs (~64MB).
const MAX_MEM = 256 * 1024 * 1024;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

/**
 * Length is the only rule.
 *
 * Composition rules (a digit, a symbol, a capital) push people towards
 * `Password1!` and are worse than a long passphrase. NIST dropped them.
 */
export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 1024;

export function assertUsablePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you can remember beats a short password you cannot.`,
    );
  }
  // Unbounded input into a memory-hard KDF is a denial-of-service vector.
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new WeakPasswordError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }
}

/** `scrypt$N$r$p$salt$key`, all base64url. Self-describing so the cost can move. */
export async function hashPassword(password: string): Promise<string> {
  assertUsablePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const { N, r, p } = SCRYPT_PARAMS;
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Constant-time verification.
 *
 * Never throws on a malformed stored hash — it returns false. A corrupt row
 * should fail the login, not 500 the endpoint and reveal that the account
 * exists.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // A hostile row could otherwise ask for an unbounded amount of memory.
  if (N > 2 ** 20 || r > 32 || p > 16) return false;

  let expected: Buffer;
  let actual: Buffer;
  try {
    const salt = Buffer.from(parts[4]!, "base64url");
    expected = Buffer.from(parts[5]!, "base64url");
    if (salt.length === 0 || expected.length === 0) return false;
    actual = await scrypt(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
      maxmem: MAX_MEM,
    });
  } catch {
    return false;
  }

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** True when a stored hash used weaker parameters than we now require. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return (
    Number(parts[1]) < SCRYPT_PARAMS.N ||
    Number(parts[2]) < SCRYPT_PARAMS.r ||
    Number(parts[3]) < SCRYPT_PARAMS.p
  );
}

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------

/**
 * The value that goes in the cookie. 32 random bytes — not a JWT.
 *
 * An opaque token means logout is a DELETE that actually revokes; a signed token
 * stays valid until it expires no matter what the server thinks.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What gets stored. A plain SHA-256 is right here and scrypt would be wrong:
 * the token is already 256 bits of entropy, so there is nothing to brute-force,
 * and the lookup happens on every request.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Sessions last a month; `lastSeenAt` is what makes a stale one visible. */
export const SESSION_TTL_DAYS = 30;

export function sessionExpiry(from: Date): Date {
  return new Date(from.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}
