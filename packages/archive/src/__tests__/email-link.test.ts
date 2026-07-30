import { describe, expect, it } from "vitest";
import { extractArchiveLink, isLinkedInHost, looksLikeZip } from "../email-link.js";

describe("extractArchiveLink", () => {
  it("finds a direct download link and marks it fetchable", () => {
    const link = extractArchiveLink(
      `<p>Your archive is ready.</p>
       <a href="https://www.linkedin.com/dms/download/abc123?token=xyz">Download</a>`,
    );
    expect(link?.url).toBe("https://www.linkedin.com/dms/download/abc123?token=xyz");
    expect(link?.requiresMemberSession).toBe(false);
  });

  it("flags a settings-page link as needing the member's session", () => {
    // This is the common case — the roadmap's "zero user steps" only holds when
    // the link happens to serve the file directly.
    const link = extractArchiveLink(
      `<a href="https://www.linkedin.com/psettings/download-my-data">Get your data</a>`,
    );
    expect(link?.requiresMemberSession).toBe(true);
  });

  it("unwraps LinkedIn's click tracker", () => {
    const inner = encodeURIComponent("https://www.linkedin.com/dms/download/abc123");
    const link = extractArchiveLink(
      `<a href="https://www.linkedin.com/comm/l/?url=${inner}&amp;t=1">Download</a>`,
    );
    expect(link?.url).toBe("https://www.linkedin.com/dms/download/abc123");
  });

  it("decodes HTML entities in the URL", () => {
    const link = extractArchiveLink(
      `<a href="https://www.linkedin.com/dms/download/abc?a=1&amp;b=2">x</a>`,
    );
    expect(link?.url).toBe("https://www.linkedin.com/dms/download/abc?a=1&b=2");
  });

  it("returns null when there is no archive link", () => {
    expect(extractArchiveLink("<p>You have 3 new connection requests.</p>")).toBeNull();
  });

  it("does not match a lookalike host", () => {
    // This URL gets fetched and unzipped — a loose match is a way to point the
    // ingestion pipeline at an attacker-chosen file.
    expect(
      extractArchiveLink(`<a href="https://www.linkedin.com.evil.co/dms/download/x">go</a>`),
    ).toBeNull();
  });

  it("is repeatable across calls", () => {
    // Module-level /g regexes carry lastIndex; a second call must not skip.
    const body = `<a href="https://www.linkedin.com/dms/download/abc">x</a>`;
    expect(extractArchiveLink(body)).not.toBeNull();
    expect(extractArchiveLink(body)).not.toBeNull();
  });
});

describe("isLinkedInHost", () => {
  it("accepts linkedin.com and its subdomains over https", () => {
    expect(isLinkedInHost("https://www.linkedin.com/x")).toBe(true);
    expect(isLinkedInHost("https://linkedin.com/x")).toBe(true);
    expect(isLinkedInHost("https://cdn.linkedin.com/x")).toBe(true);
  });

  it("rejects lookalikes, plaintext, and junk", () => {
    expect(isLinkedInHost("https://linkedin.com.evil.co/x")).toBe(false);
    expect(isLinkedInHost("https://notlinkedin.com/x")).toBe(false);
    expect(isLinkedInHost("http://www.linkedin.com/x")).toBe(false);
    expect(isLinkedInHost("not a url")).toBe(false);
  });
});

describe("looksLikeZip", () => {
  it("accepts a ZIP local-file header", () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
  });

  it("accepts the empty-archive variant", () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
  });

  it("rejects an HTML login page", () => {
    // Content-Type alone isn't enough — a login page parsed as an empty archive
    // looks exactly like a user with no connections.
    const html = new TextEncoder().encode("<!DOCTYPE html><html><body>Sign in");
    expect(looksLikeZip(html)).toBe(false);
  });

  it("rejects a body too short to classify", () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});
