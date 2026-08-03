import { describe, expect, it } from "vitest";
import {
  ALL_TEMPLATES,
  CURRENT,
  MissingVariableError,
  getTemplate,
  render,
} from "../registry.js";

const template = {
  name: "test.prompt",
  version: "1.0.0",
  variables: ["a", "b"] as const,
  template: "A={{a}} B={{b}}",
};

describe("render", () => {
  it("substitutes variables", () => {
    expect(render(template, { a: "1", b: "2" })).toBe("A=1 B=2");
  });

  it("throws rather than shipping a post with {{persona}} in it", () => {
    expect(() => render(template, { a: "1" })).toThrow(MissingVariableError);
    expect(() => render(template, { a: "1", b: "   " })).toThrow(MissingVariableError);
  });

  it("names every missing variable at once", () => {
    try {
      render(template, {});
      expect.unreachable();
    } catch (e) {
      expect((e as MissingVariableError).missing).toEqual(["a", "b"]);
    }
  });

  it("leaves unknown placeholders visible instead of blanking them", () => {
    // An unknown placeholder is a template bug; hiding it ships a post with a
    // hole where a sentence should be.
    const withExtra = { ...template, template: "A={{a}} B={{b}} C={{c}}" };
    expect(render(withExtra, { a: "1", b: "2" })).toBe("A=1 B=2 C={{c}}");
  });

  it("substitutes optional variables when supplied", () => {
    const optional = { ...template, variables: ["a"] as const, template: "{{a}}/{{opt}}" };
    expect(render(optional, { a: "1", opt: "2" })).toBe("1/2");
  });
});

describe("registry", () => {
  it("retrieves an exact historical version so past generations can be replayed", () => {
    expect(getTemplate("content.draft", "1.0.0").name).toBe("content.draft");
  });

  it("throws on an unknown version rather than falling back to current", () => {
    expect(() => getTemplate("content.draft", "9.9.9")).toThrow();
  });

  it("registers every template under a unique name@version", () => {
    const keys = ALL_TEMPLATES.map((t) => `${t.name}@${t.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("points every CURRENT entry at a registered template", () => {
    for (const t of Object.values(CURRENT)) {
      expect(getTemplate(t.name, t.version)).toBe(t);
    }
  });

  it("does not grow the set of placeholders no one declared", () => {
    // A placeholder that is interpolated but not declared is invisible to
    // render()'s check, so omitting it ships the literal "{{documentSignal}}"
    // into the prompt instead of throwing.
    //
    // These four are safe *today* only because every caller happens to pass them,
    // with a fallback string when there is nothing to say. That is a property of
    // the callers, not of the templates, and nothing enforces it. Published
    // versions are immutable so they stay as they shipped; this list must not
    // grow, and each entry should disappear when its template is next versioned.
    const undeclared: string[] = [];
    for (const t of ALL_TEMPLATES) {
      const used = new Set([...t.template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!));
      for (const name of used) {
        if (!t.variables.includes(name)) undeclared.push(`${t.name}@${t.version}: ${name}`);
      }
    }

    // Shrinks as each template is superseded by one that declares properly.
    // content.draft@1.2.0 is absent because it does.
    expect(undeclared.sort()).toEqual([
      "content.draft@1.0.0: peerPatterns",
      "content.draft@1.1.0: documentSignal",
      "content.draft@1.1.0: peerPatterns",
      "intake.followup@1.0.0: seededContext",
    ]);
  });

  it("declares every placeholder in the newest intake prompt", () => {
    // The fix for the above, applied where it is allowed to be applied: in the
    // version that supersedes the one with the gap.
    const t = getTemplate("intake.followup", "1.1.0");
    const used = [...t.template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
    for (const name of used) expect(t.variables).toContain(name);
  });

  it("keeps published versions byte-identical when a successor lands", () => {
    // The audit trail claims a Generation used a specific version. Editing that
    // version in place rewrites the explanation for work already shipped.
    expect(getTemplate("intake.followup", "1.0.0").template).toContain(
      "Ask ONE follow-up question that closes the most important open criterion.",
    );
    expect(getTemplate("intake.followup", "1.0.0").template).not.toContain(
      "credit everything that is already answered",
    );
  });
});

describe("intake.followup@1.1.0", () => {
  const current = CURRENT.intakeFollowup;

  it("is what new intakes use", () => {
    expect(current.version).toBe("1.1.0");
  });

  it("asks the model to credit before it asks", () => {
    // The over-probing bug: v1.0.0 only ever credited the criterion its own
    // question targeted, so an area with five required criteria cost five turns
    // regardless of how much a single answer had already established.
    const creditAt = current.template.indexOf("credit everything that is already answered");
    const askAt = current.template.indexOf("ask one question");
    expect(creditAt).toBeGreaterThan(-1);
    expect(askAt).toBeGreaterThan(creditAt);
  });

  it("tells the model to read the whole transcript, not just the last answer", () => {
    expect(current.template).toContain("not only the most recent answer");
  });

  it("still refuses to let the model decide the area is finished", () => {
    // isSlotComplete owns that decision; a persuasive answer must not be able to
    // close an area with required criteria still open.
    expect(current.template).toContain("a separate system decides when this area is done");
  });

  it("renders with exactly the values the intake service passes", () => {
    const rendered = render(current, {
      areaTitle: "Who they are",
      areaIntent: "Establish role, industry, niche.",
      openCriteria: "- role: Current role",
      seededContext: "(nothing seeded)",
      transcript: "USER: I sell fractional ops leadership.",
    });
    expect(rendered).not.toContain("{{");
  });
});
