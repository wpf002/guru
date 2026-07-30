import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Envelope encryption for OAuth tokens (roadmap §0.8).
 *
 * Each token gets a fresh 256-bit data key. The data key is wrapped with the
 * master key from `TOKEN_ENCRYPTION_KEY` (Railway secrets), and only the wrapped
 * form is stored. Rotating the master key therefore means rewrapping data keys —
 * not decrypting and re-encrypting every token, and not forcing every user to
 * re-authorize.
 *
 * Both layers are AES-256-GCM, so tampering fails at unwrap rather than
 * surfacing as a corrupt token later.
 *
 * The plaintext returned here must never be logged, never serialized into an
 * error, and never cross the wire to the client.
 */

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface Envelope {
  /** Master key version this envelope's data key is wrapped under. */
  v: number;
  /** Wrapped data key: iv + tag + ciphertext, base64. */
  k: string;
  /** Payload: iv + tag + ciphertext, base64. */
  c: string;
}

export class CryptoConfigError extends Error {}
export class DecryptError extends Error {}

function loadMasterKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new CryptoConfigError(
      "TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new CryptoConfigError(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }
  return key;
}

function seal(plaintext: Buffer, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

function open(packed: string, key: Buffer): Buffer {
  const buf = Buffer.from(packed, "base64");
  if (buf.length < IV_BYTES + 16) {
    throw new DecryptError("Ciphertext is too short to be well-formed.");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + 16);
  const body = buf.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // Deliberately opaque: the GCM failure reason is not useful to a caller and
    // is useful to an attacker.
    throw new DecryptError("Token could not be decrypted.");
  }
}

export function encryptToken(plaintext: string, keyVersion = 1): string {
  const master = loadMasterKey();
  const dataKey = randomBytes(KEY_BYTES);
  try {
    const envelope: Envelope = {
      v: keyVersion,
      k: seal(dataKey, master),
      c: seal(Buffer.from(plaintext, "utf8"), dataKey),
    };
    return JSON.stringify(envelope);
  } finally {
    dataKey.fill(0);
  }
}

export function decryptToken(serialized: string): string {
  const master = loadMasterKey();
  let envelope: Envelope;
  try {
    envelope = JSON.parse(serialized) as Envelope;
  } catch {
    throw new DecryptError("Stored token is not a well-formed envelope.");
  }
  if (!envelope?.k || !envelope?.c) {
    throw new DecryptError("Stored token is not a well-formed envelope.");
  }
  const dataKey = open(envelope.k, master);
  try {
    return open(envelope.c, dataKey).toString("utf8");
  } finally {
    dataKey.fill(0);
  }
}

/**
 * Rewrap under a new master key without touching the payload. Call with the new
 * key active and the old one passed explicitly.
 */
export function rewrapToken(
  serialized: string,
  oldMasterBase64: string,
  newKeyVersion: number,
): string {
  const oldMaster = Buffer.from(oldMasterBase64, "base64");
  if (oldMaster.length !== KEY_BYTES) {
    throw new CryptoConfigError("Old master key must decode to 32 bytes.");
  }
  const newMaster = loadMasterKey();
  const envelope = JSON.parse(serialized) as Envelope;
  const dataKey = open(envelope.k, oldMaster);
  try {
    return JSON.stringify({
      v: newKeyVersion,
      k: seal(dataKey, newMaster),
      c: envelope.c,
    } satisfies Envelope);
  } finally {
    dataKey.fill(0);
  }
}

/** Constant-time compare for OAuth `state` and similar. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
