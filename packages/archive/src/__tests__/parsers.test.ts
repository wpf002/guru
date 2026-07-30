import { describe, expect, it } from "vitest";
import {
  parseComments,
  parseConnections,
  parseInvitations,
  parseMessages,
  parseShares,
  stripPreamble,
} from "../parsers.js";

/** Real exports open with a Notes: preamble before the header row. */
const PREAMBLE = `Notes:
"When exporting your connection data, you may notice that some of your connections do not have an email address."

`;

const CONNECTIONS = `${PREAMBLE}First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe 🚀 | MBA,https://www.linkedin.com/in/janedoe,,Acme Corp.,VP Operations,15 Mar 2023
John,Smith,https://www.linkedin.com/in/johnsmith,john@example.com,Acme Corporation,Director,01 Apr 2023
,,,,,,
Ana,"Lopez, PMP",https://www.linkedin.com/in/analopez,,Beta LLC,,22 Dec 2024
`;

describe("stripPreamble", () => {
  it("drops the Notes: block ahead of the header row", () => {
    expect(stripPreamble(CONNECTIONS).startsWith("First Name,Last Name")).toBe(true);
  });

  it("leaves a file with no preamble untouched", () => {
    const plain = "First Name,Last Name\nJane,Doe\n";
    expect(stripPreamble(plain)).toBe(plain);
  });
});

describe("parseConnections", () => {
  const { records, report } = parseConnections(CONNECTIONS);

  it("parses every real row and skips the blank one", () => {
    expect(report.rows).toBe(3);
    expect(report.skipped).toBe(1);
  });

  it("strips emoji and credentials for matching but keeps the raw row", () => {
    const jane = records[0]!;
    expect(jane.normalizedName).toBe("jane doe");
    expect(jane.lastName).toBe("Doe 🚀 | MBA");
    expect(jane.rawRow["First Name"]).toBe("Jane");
  });

  it("normalizes company suffixes so Acme Corp. and Acme Corporation match", () => {
    expect(records[0]!.normalizedCompany).toBe("acme");
    expect(records[1]!.normalizedCompany).toBe("acme");
  });

  it("parses LinkedIn's day-month-year dates", () => {
    expect(records[0]!.connectedOn?.toISOString().slice(0, 10)).toBe("2023-03-15");
  });

  it("leaves a blank position null rather than empty string", () => {
    expect(records[2]!.position).toBeNull();
  });

  it("warns when almost no emails came through", () => {
    const rows = Array.from(
      { length: 30 },
      (_, i) => `First${i},Last${i},https://linkedin.com/in/p${i},,Acme,Analyst,01 Apr 2023`,
    ).join("\n");
    const large = parseConnections(
      `First Name,Last Name,URL,Email Address,Company,Position,Connected On\n${rows}\n`,
    );
    expect(large.report.warnings.join(" ")).toMatch(/withholds it unless/);
  });

  it("stays quiet about email coverage on a handful of rows", () => {
    // One row either way swings the ratio between 0% and 50% at this size.
    expect(report.warnings.join(" ")).not.toMatch(/withholds it unless/);
  });

  it("handles an empty file without throwing", () => {
    const empty = parseConnections("First Name,Last Name,URL\n");
    expect(empty.records).toHaveLength(0);
    expect(empty.report.rows).toBe(0);
  });
});

describe("parseShares", () => {
  it("parses posts and skips contentless rows", () => {
    const { records, report } = parseShares(
      `Date,ShareLink,ShareCommentary,Visibility
2024-05-01,https://linkedin.com/feed/x,"Here is a thing I think.",PUBLIC
2024-05-02,,,PUBLIC
`,
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.content).toBe("Here is a thing I think.");
    expect(report.skipped).toBe(1);
  });
});

describe("parseComments", () => {
  it("keeps only comments with text — the voice corpus needs words", () => {
    const { records, report } = parseComments(
      `Date,Link,Message
2024-05-01,https://linkedin.com/feed/a,"Disagree — the constraint is distribution."
2024-05-02,https://linkedin.com/feed/b,
`,
    );
    expect(records).toHaveLength(1);
    expect(report.skipped).toBe(1);
    expect(report.warnings.join(" ")).toMatch(/voice modeling/);
  });
});

describe("parseMessages", () => {
  it("parses DMs without marking any of them usable for analysis", () => {
    const { records } = parseMessages(
      `CONVERSATION ID,FROM,TO,DATE,CONTENT
c1,Jane Doe,John Smith,2024-05-01,"Following up on the proposal."
`,
    );
    expect(records).toHaveLength(1);
    expect(records[0]!.conversationId).toBe("c1");
    // Opt-in is the only defensible default for other people's words — the
    // parser must not decide this.
    expect(records[0]).not.toHaveProperty("usableForAnalysis");
  });
});

describe("parseInvitations", () => {
  it("parses direction so acceptance rate can be computed", () => {
    const { records } = parseInvitations(
      `From,To,Sent At,Direction,Message
Jane Doe,John Smith,2024-05-01,OUTGOING,
`,
    );
    expect(records[0]!.direction).toBe("OUTGOING");
  });
});
