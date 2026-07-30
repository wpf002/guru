import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  CryptoConfigError,
  DecryptError,
  decryptToken,
  encryptToken,
  rewrapToken,
  safeEqual,
} from "../crypto.js";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

describe("token envelope encryption", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
  });

  it("round-trips a token", () => {
    const token = "AQXbz...linkedin-access-token";
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it("produces different ciphertext for the same plaintext", () => {
    // Fresh data key + fresh IV per call, so identical tokens are not linkable
    // by comparing rows.
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });

  it("rejects a missing master key", () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(CryptoConfigError);
  });

  it("rejects a master key of the wrong length", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.from("too short").toString("base64");
    expect(() => encryptToken("x")).toThrow(CryptoConfigError);
  });

  it("fails closed when the payload is tampered with", () => {
    const sealed = JSON.parse(encryptToken("secret"));
    const buf = Buffer.from(sealed.c, "base64");
    const last = buf.length - 1;
    buf.writeUInt8(buf.readUInt8(last) ^ 0xff, last);
    sealed.c = buf.toString("base64");
    expect(() => decryptToken(JSON.stringify(sealed))).toThrow(DecryptError);
  });

  it("fails closed under the wrong master key", () => {
    const sealed = encryptToken("secret");
    process.env.TOKEN_ENCRYPTION_KEY = KEY_B;
    expect(() => decryptToken(sealed)).toThrow(DecryptError);
  });

  it("rejects malformed envelopes rather than throwing a parse error", () => {
    expect(() => decryptToken("not json")).toThrow(DecryptError);
    expect(() => decryptToken('{"v":1}')).toThrow(DecryptError);
  });

  it("rotates the master key without re-encrypting the payload", () => {
    const sealed = encryptToken("rotate-me", 1);
    const payloadBefore = JSON.parse(sealed).c;

    process.env.TOKEN_ENCRYPTION_KEY = KEY_B;
    const rewrapped = rewrapToken(sealed, KEY_A, 2);

    expect(JSON.parse(rewrapped).c).toBe(payloadBefore);
    expect(JSON.parse(rewrapped).v).toBe(2);
    expect(decryptToken(rewrapped)).toBe("rotate-me");
  });
});

describe("safeEqual", () => {
  it("compares equal and unequal values", () => {
    expect(safeEqual("state-abc", "state-abc")).toBe(true);
    expect(safeEqual("state-abc", "state-abd")).toBe(false);
    expect(safeEqual("short", "longer-value")).toBe(false);
  });
});
