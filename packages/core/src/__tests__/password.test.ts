import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  SCRYPT_PARAMS,
  WeakPasswordError,
  assertUsablePassword,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  needsRehash,
  sessionExpiry,
  verifyPassword,
} from "../password.js";

const GOOD = "correct horse battery staple";

describe("hashPassword / verifyPassword", () => {
  it("round-trips", async () => {
    const hash = await hashPassword(GOOD);
    expect(await verifyPassword(GOOD, hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword(GOOD);
    expect(await verifyPassword("correct horse battery stapl", hash)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    // Otherwise identical passwords are visibly identical in the table, and one
    // cracked hash cracks every account that shares it.
    const [a, b] = await Promise.all([hashPassword(GOOD), hashPassword(GOOD)]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(GOOD, a)).toBe(true);
    expect(await verifyPassword(GOOD, b)).toBe(true);
  });

  it("stores its own parameters so the cost can be raised later", async () => {
    const hash = await hashPassword(GOOD);
    const [scheme, n, r, p] = hash.split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBe(SCRYPT_PARAMS.N);
    expect(Number(r)).toBe(SCRYPT_PARAMS.r);
    expect(Number(p)).toBe(SCRYPT_PARAMS.p);
  });

  it("normalizes unicode, so the same typed phrase works across keyboards", async () => {
    // Escape sequences, not literals. Written as visually identical source
    // text these two are the same bytes and the test asserts nothing — the
    // first version of this test did exactly that.
    const composed = "contrase\u00F1a muy larga"; // n-tilde as one code point
    const decomposed = "contrase\u006E\u0303a muy larga"; // n + combining tilde
    expect(composed).not.toBe(decomposed);

    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  describe("malformed stored hashes", () => {
    // A corrupt row must fail the login, not throw — a 500 here tells an
    // attacker the account exists.
    const bad = [
      "",
      "not-a-hash",
      "scrypt$16384$8$1$onlyfiveparts",
      "bcrypt$16384$8$1$c2FsdA$a2V5",
      "scrypt$abc$8$1$c2FsdA$a2V5",
      "scrypt$16384$8$1$$a2V5",
      "scrypt$16384$8$1$c2FsdA$",
    ];

    for (const stored of bad) {
      it(`returns false for ${JSON.stringify(stored.slice(0, 32))}`, async () => {
        await expect(verifyPassword(GOOD, stored)).resolves.toBe(false);
      });
    }

    it("refuses absurd parameters rather than allocating on demand", async () => {
      // A hostile row asking for N=2^30 would otherwise try to allocate its way
      // to a denial of service.
      await expect(verifyPassword(GOOD, "scrypt$1073741824$8$1$c2FsdA$a2V5")).resolves.toBe(
        false,
      );
    });
  });
});

describe("assertUsablePassword", () => {
  it("requires length and nothing else", () => {
    expect(() => assertUsablePassword("a".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
    // Composition rules produce Password1!; a long phrase is stronger.
    expect(() => assertUsablePassword("all lowercase words no digits")).not.toThrow();
  });

  it("rejects short passwords", () => {
    expect(() => assertUsablePassword("short")).toThrow(WeakPasswordError);
  });

  it("rejects unbounded input into a memory-hard KDF", () => {
    expect(() => assertUsablePassword("a".repeat(2000))).toThrow(WeakPasswordError);
  });

  it("is enforced by hashPassword, not just by callers", async () => {
    await expect(hashPassword("tooshort")).rejects.toThrow(WeakPasswordError);
  });
});

describe("needsRehash", () => {
  it("is false for a hash made with current parameters", async () => {
    expect(needsRehash(await hashPassword(GOOD))).toBe(false);
  });

  it("is true for weaker parameters, so login can upgrade it", () => {
    expect(needsRehash("scrypt$16384$8$1$c2FsdA$a2V5")).toBe(true);
  });

  it("is true for anything unrecognized", () => {
    expect(needsRehash("bcrypt$whatever")).toBe(true);
  });
});

describe("session tokens", () => {
  it("generates unguessable, distinct tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateSessionToken));
    expect(tokens.size).toBe(100);
    // 32 bytes base64url.
    expect(generateSessionToken().length).toBeGreaterThanOrEqual(43);
  });

  it("stores only a hash, so a database leak does not hand over live sessions", () => {
    const token = generateSessionToken();
    const stored = hashSessionToken(token);
    expect(stored).not.toBe(token);
    expect(stored).not.toContain(token);
    expect(hashSessionToken(token)).toBe(stored);
  });

  it("is url-safe, because it travels in a cookie", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("expires in the future", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(sessionExpiry(now).getTime()).toBeGreaterThan(now.getTime());
  });
});
