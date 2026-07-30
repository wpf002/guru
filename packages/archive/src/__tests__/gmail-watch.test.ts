import { describe, expect, it } from "vitest";
import { classify, isFromLinkedIn, selectNew } from "../gmail-watch.js";

const at = (iso: string) => new Date(iso);

describe("isFromLinkedIn", () => {
  it("accepts LinkedIn's sending domains", () => {
    expect(isFromLinkedIn("LinkedIn <messages-noreply@linkedin.com>")).toBe(true);
    expect(isFromLinkedIn("security-noreply@e.linkedin.com")).toBe(true);
  });

  it("rejects lookalike senders", () => {
    // This pipeline downloads and unzips what it is pointed at, so an
    // archive-ready email is an obvious phishing lure.
    expect(isFromLinkedIn("LinkedIn <noreply@linkedin.com.evil.co>")).toBe(false);
    expect(isFromLinkedIn("noreply@1inkedin.com")).toBe(false);
  });
});

describe("classify", () => {
  const base = { from: "noreply@linkedin.com", receivedAt: at("2026-07-01"), messageId: "m1" };

  it("identifies the first installment", () => {
    const d = classify({
      ...base,
      subject: "The first installment of your LinkedIn data archive is ready!",
    });
    expect(d?.installment).toBe("FIRST");
  });

  it("treats a later archive email as the second installment", () => {
    const d = classify({ ...base, subject: "Your LinkedIn data archive is ready" });
    expect(d?.installment).toBe("SECOND");
  });

  it("ignores unrelated LinkedIn mail", () => {
    expect(classify({ ...base, subject: "You have 3 new connection requests" })).toBeNull();
  });

  it("ignores a spoofed archive email", () => {
    expect(
      classify({
        ...base,
        from: "noreply@linkedin-support.co",
        subject: "The first installment of your LinkedIn data archive is ready!",
      }),
    ).toBeNull();
  });
});

describe("selectNew", () => {
  const headers = [
    {
      from: "noreply@linkedin.com",
      subject: "The first installment of your LinkedIn data archive is ready!",
      receivedAt: at("2026-07-02"),
      messageId: "m1",
    },
    {
      from: "noreply@linkedin.com",
      subject: "Your LinkedIn data archive is ready",
      receivedAt: at("2026-07-03"),
      messageId: "m2",
    },
  ];

  it("returns both installments in arrival order", () => {
    const found = selectNew(headers, []);
    expect(found.map((d) => d.installment)).toEqual(["FIRST", "SECOND"]);
  });

  it("skips already-ingested messages so polling is idempotent", () => {
    // The watcher polls; without this the same archive downloads on every tick.
    expect(selectNew(headers, ["m1"]).map((d) => d.messageId)).toEqual(["m2"]);
    expect(selectNew(headers, ["m1", "m2"])).toHaveLength(0);
  });
});
