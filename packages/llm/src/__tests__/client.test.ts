import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import {
  GuruLlm,
  LlmRefusalError,
  LlmSchemaError,
  MODEL,
  type GenerationRecord,
} from "../client.js";

/**
 * The model is faked here, so these tests cover what we actually control: that
 * every outcome — success, refusal, truncation, transport failure — leaves an
 * audit row behind, and that a bad artifact fails at this boundary rather than
 * three layers downstream.
 */

interface FakeResponse {
  stop_reason: string;
  stop_details?: { category?: string } | null;
  content: { type: string; text?: string }[];
  usage?: { input_tokens: number; output_tokens: number };
}

function harness(response: FakeResponse | Error) {
  const recorded: GenerationRecord[] = [];
  const sink = vi.fn(async (record: GenerationRecord) => {
    recorded.push(record);
    return { id: `gen_${recorded.length}` };
  });

  // Typed with a parameter so the request-shape assertions below can read
  // create.mock.calls[n][0].
  const create = vi.fn(async (_params: Record<string, unknown>) => {
    void _params;
    if (response instanceof Error) throw response;
    return {
      usage: { input_tokens: 100, output_tokens: 50 },
      ...response,
    };
  });

  const fakeClient = { beta: { messages: { create } } } as unknown as Anthropic;
  return { llm: new GuruLlm(sink, fakeClient), recorded, create };
}

const options = {
  userId: "user_1",
  purpose: "content.draft",
  promptName: "content.draft",
  promptVersion: "1.0.0",
  system: "stable prefix",
  prompt: "volatile question",
};

describe("text generation", () => {
  it("returns the text and records the generation", async () => {
    const { llm, recorded } = harness({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "a finished post" }],
    });

    const result = await llm.text(options);

    expect(result.value).toBe("a finished post");
    expect(result.generationId).toBe("gen_1");
    expect(recorded[0]).toMatchObject({
      userId: "user_1",
      promptName: "content.draft",
      promptVersion: "1.0.0",
      model: MODEL,
      output: "a finished post",
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it("records the resolved inputs, not references to them", async () => {
    // The brief and voice profile that produced a draft are both mutable; a
    // foreign key to a since-edited row explains nothing a year later.
    const { llm, recorded } = harness({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    });

    await llm.text({ ...options, auditInputs: { briefVersion: 2, voiceVersion: 5 } });

    expect(recorded[0]!.inputs).toMatchObject({
      system: "stable prefix",
      prompt: "volatile question",
      briefVersion: 2,
      voiceVersion: 5,
    });
  });

  it("keeps a redacted prompt out of the audit row but still sends it", async () => {
    // §0.7: meeting transcripts are summarized and discarded. Auditing the
    // prompt verbatim would quietly reintroduce them to the database.
    const { llm, recorded, create } = harness({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    });

    await llm.text({
      ...options,
      prompt: "CONFIDENTIAL TRANSCRIPT: margin is 3%",
      redactPrompt: true,
    });

    const audited = JSON.stringify(recorded[0]!.inputs);
    expect(audited).not.toContain("CONFIDENTIAL");
    expect(audited).toMatch(/redacted — \d+ chars not persisted/);

    // The model still receives it — redaction is about persistence, not input.
    const sent = create.mock.calls[0]![0] as any;
    expect(sent.messages[0].content).toContain("CONFIDENTIAL");
  });

  it("joins multiple text blocks", async () => {
    const { llm } = harness({
      stop_reason: "end_turn",
      content: [
        { type: "thinking" },
        { type: "text", text: "first " },
        { type: "text", text: "second" },
      ],
    });
    expect((await llm.text(options)).value).toBe("first second");
  });
});

describe("request shape", () => {
  it("caches the system prefix and leaves the prompt uncached", async () => {
    const { llm, create } = harness({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    });

    await llm.text(options);
    const sent = create.mock.calls[0]![0] as Record<string, any>;

    expect(sent.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sent.messages[0].content).toBe("volatile question");
    expect(sent.thinking).toEqual({ type: "adaptive" });
    expect(sent.model).toBe(MODEL);
  });

  it("attaches a JSON schema only for structured calls", async () => {
    const { llm, create } = harness({
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"n":1}' }],
    });

    await llm.text(options);
    expect((create.mock.calls[0]![0] as any).output_config.format).toBeUndefined();

    await llm.structured(options, z.object({ n: z.number() }));
    expect((create.mock.calls[1]![0] as any).output_config.format.type).toBe("json_schema");
  });
});

describe("structured generation", () => {
  const schema = z.object({ content: z.string().min(1), whyThis: z.string().min(1) });

  it("parses and validates the output", async () => {
    const { llm } = harness({
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"content":"post","whyThis":"element 3"}' }],
    });

    const result = await llm.structured(options, schema);
    expect(result.value).toEqual({ content: "post", whyThis: "element 3" });
  });

  it("rejects output that parses but is semantically empty", async () => {
    // A constrained decode still can't guarantee a non-empty rationale, and an
    // artifact that can't explain itself is worse than a failed generation.
    const { llm } = harness({
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"content":"post","whyThis":""}' }],
    });

    await expect(llm.structured(options, schema)).rejects.toThrow(LlmSchemaError);
  });

  it("rejects non-JSON and keeps the raw text for debugging", async () => {
    const { llm } = harness({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Here is your post!" }],
    });

    await expect(llm.structured(options, schema)).rejects.toMatchObject({
      name: "LlmSchemaError",
      raw: "Here is your post!",
    });
  });
});

describe("failure paths", () => {
  it("raises a typed refusal and records the category", async () => {
    const { llm, recorded } = harness({
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
      content: [],
    });

    await expect(llm.text(options)).rejects.toBeInstanceOf(LlmRefusalError);
    expect(recorded[0]!.error).toBe("refusal:cyber");
  });

  it("handles a refusal with no category", async () => {
    const { llm, recorded } = harness({
      stop_reason: "refusal",
      stop_details: null,
      content: [],
    });

    await expect(llm.text(options)).rejects.toBeInstanceOf(LlmRefusalError);
    expect(recorded[0]!.error).toBe("refusal:unknown");
  });

  it("fails loudly on truncation rather than persisting a half-written post", async () => {
    const { llm, recorded } = harness({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "This post ends mid-sen" }],
    });

    await expect(llm.text(options)).rejects.toThrow(/truncated at max_tokens/);
    expect(recorded[0]!.error).toBe("max_tokens");
    expect(recorded[0]!.output).toBe("This post ends mid-sen");
  });

  it("records transport failures before rethrowing", async () => {
    const { llm, recorded } = harness(new Error("connection reset"));

    await expect(llm.text(options)).rejects.toThrow("connection reset");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.error).toBe("connection reset");
  });

  it("writes exactly one audit row per call", async () => {
    const { llm, recorded } = harness({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    });

    await llm.text(options);
    await llm.text(options);
    expect(recorded).toHaveLength(2);
  });
});
