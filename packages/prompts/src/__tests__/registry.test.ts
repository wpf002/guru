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
});
