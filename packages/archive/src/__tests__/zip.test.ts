import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import {
  ArchiveUnpackError,
  canonicalArchiveName,
  classifyContents,
  parseArchiveZip,
} from "../zip.js";

function zipOf(files: Record<string, string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content, "utf8"));
  }
  return zip.toBuffer();
}

const CONNECTIONS = `First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe,https://linkedin.com/in/janedoe,,Acme,VP Ops,15 Mar 2023
`;

const COMMENTS = `Date,Link,Message
2024-05-01,https://linkedin.com/feed/a,"Disagree — the constraint is distribution."
`;

describe("parseArchiveZip", () => {
  it("routes each file to its parser", () => {
    const contents = parseArchiveZip(
      zipOf({
        "Connections.csv": CONNECTIONS,
        "Comments.csv": COMMENTS,
      }),
    );
    expect(contents.connections).toHaveLength(1);
    expect(contents.comments).toHaveLength(1);
    expect(contents.report["Connections.csv"]?.rows).toBe(1);
  });

  it("matches file names case-insensitively and inside nested folders", () => {
    // Some exports nest everything under a folder and vary the casing.
    const contents = parseArchiveZip(
      zipOf({ "Basic_LinkedInDataExport_2026/connections.CSV": CONNECTIONS }),
    );
    expect(contents.connections).toHaveLength(1);
  });

  it("extracts article text from the Articles directory", () => {
    const contents = parseArchiveZip(
      zipOf({
        "Articles/why-ops-matters.html":
          "<html><head><title>Why Ops Matters</title></head><body><p>Because &amp; so.</p></body></html>",
      }),
    );
    expect(contents.articles[0]).toMatchObject({
      title: "Why Ops Matters",
      content: "Why Ops Matters Because & so.",
    });
  });

  it("reports unrecognised files rather than dropping them silently", () => {
    // An unrecognised file usually means LinkedIn renamed something — better to
    // learn that from a report than from an empty voice model.
    const contents = parseArchiveZip(zipOf({ "Reactions.csv": "a,b\n1,2\n" }));
    expect(contents.unrecognizedFiles).toContain("Reactions.csv");
  });

  it("rejects entries with path traversal in the name", () => {
    const contents = parseArchiveZip(zipOf({ "../../etc/passwd": "root:x:0:0" }));
    expect(contents.unrecognizedFiles).toHaveLength(1);
    expect(contents.connections).toHaveLength(0);
  });

  it("throws a typed error on a non-ZIP body", () => {
    expect(() => parseArchiveZip(Buffer.from("<html>Sign in</html>"))).toThrow(
      ArchiveUnpackError,
    );
  });

  it("handles an archive with no recognised files", () => {
    const contents = parseArchiveZip(zipOf({ "readme.txt": "hello" }));
    expect(contents.connections).toHaveLength(0);
    expect(contents.report).toEqual({});
  });
});

describe("classifyContents", () => {
  const empty = {
    connections: [],
    shares: [],
    comments: [],
    messages: [],
    invitations: [],
    articles: [],
    report: {},
    unrecognizedFiles: [],
  };

  it("calls a connections-only archive the first installment", () => {
    expect(classifyContents({ ...empty, connections: [{} as never] })).toBe("FIRST");
  });

  it("calls a connections-less archive the second installment", () => {
    expect(classifyContents({ ...empty, comments: [{} as never] })).toBe("SECOND");
  });

  it("calls a full archive complete", () => {
    expect(
      classifyContents({
        ...empty,
        connections: [{} as never],
        shares: [{} as never],
      }),
    ).toBe("COMPLETE");
  });
});

describe("canonicalArchiveName", () => {
  it("strips the member-id suffix real exports carry", () => {
    // A genuine export names these Shares_1638994912.csv and
    // Comments_1638994912.csv, not the clean names the docs imply.
    expect(canonicalArchiveName("Shares_1638994912.csv")).toBe("shares.csv");
    expect(canonicalArchiveName("Comments_1638994912.csv")).toBe("comments.csv");
    expect(canonicalArchiveName("Reactions_1638994912.csv")).toBe("reactions.csv");
  });

  it("leaves clean names alone", () => {
    expect(canonicalArchiveName("Connections.csv")).toBe("connections.csv");
    expect(canonicalArchiveName("messages.csv")).toBe("messages.csv");
    expect(canonicalArchiveName("Jobs/Saved Jobs.csv")).toBe("saved jobs.csv");
  });

  it("does not collapse a different file onto a known one", () => {
    // learning_coach_messages.csv must not become messages.csv — only a
    // trailing _<digits> is a member id.
    expect(canonicalArchiveName("learning_coach_messages.csv")).toBe(
      "learning_coach_messages.csv",
    );
    expect(canonicalArchiveName("Member_Follows_1638994912.csv")).toBe("member_follows.csv");
  });
});

describe("unpacking a real export's filenames", () => {
  it("finds shares and comments despite the member-id suffix", () => {
    const zip = new AdmZip();
    zip.addFile(
      "Connections.csv",
      Buffer.from(
        `First Name,Last Name,URL,Email Address,Company,Position,Connected On
Jane,Doe,https://linkedin.com/in/janedoe,,Acme,VP Ops,15 Mar 2023
`,
        "utf8",
      ),
    );
    zip.addFile(
      "Shares_1638994912.csv",
      Buffer.from(`Date,ShareLink,ShareCommentary\n2024-05-01,https://x,"A post."\n`, "utf8"),
    );
    zip.addFile(
      "Comments_1638994912.csv",
      Buffer.from(`Date,Link,Message\n2024-05-01,https://y,"A comment."\n`, "utf8"),
    );

    const contents = parseArchiveZip(zip.toBuffer());

    expect(contents.connections).toHaveLength(1);
    // Before the fix both of these were 0 and the files landed in
    // unrecognizedFiles, while ingestion still reported success.
    expect(contents.shares).toHaveLength(1);
    expect(contents.comments).toHaveLength(1);
    expect(contents.unrecognizedFiles).toEqual([]);
  });
});
