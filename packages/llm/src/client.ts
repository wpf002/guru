import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/**
 * The model layer — roadmap §0.8.
 *
 * Every call through here writes a Generation row: resolved inputs, prompt name,
 * prompt version, model, output. Not a wrapper for tidiness — it is what makes
 * "why did it suggest this" answerable a year later, after the prompts have
 * moved on and the brief has been edited twice.
 *
 * Persisting the *resolved* inputs rather than references to them is deliberate:
 * the brief, the voice profile, and the roadmap element that produced a draft
 * are all mutable, and a foreign key to a since-edited row explains nothing.
 */

export const MODEL = "claude-opus-5";

/** Anthropic's recommended fallback routing when a safety classifier declines. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface GenerationRecord {
  userId: string;
  purpose: string;
  promptName: string;
  promptVersion: string;
  model: string;
  inputs: unknown;
  output?: string;
  outputJson?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  error?: string;
}

/** Injected so the model layer doesn't depend on Prisma and stays unit-testable. */
export type GenerationSink = (record: GenerationRecord) => Promise<{ id: string }>;

export interface CallOptions {
  userId: string;
  purpose: string;
  promptName: string;
  promptVersion: string;
  /**
   * The stable prefix — brief, voice profile, framework. Cached, so it must be
   * byte-identical across calls. Anything with a timestamp or a per-request id
   * belongs in `prompt`, not here (see packages/llm/README of §0.8).
   */
  system: string;
  prompt: string;
  effort?: Effort;
  maxTokens?: number;
  /** Extra context recorded on the Generation row beyond system + prompt. */
  auditInputs?: Record<string, unknown>;
}

export interface CallResult<T> {
  value: T;
  generationId: string;
}

export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(
      `The model declined this request${category ? ` (${category})` : ""}. ` +
        "This is a content outcome, not a transport failure — do not retry unchanged.",
    );
    this.name = "LlmRefusalError";
  }
}

export class LlmSchemaError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "LlmSchemaError";
  }
}

export class GuruLlm {
  private readonly client: Anthropic;

  constructor(
    private readonly recordGeneration: GenerationSink,
    client?: Anthropic,
  ) {
    // Zero-arg constructor resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or
    // an `ant auth login` profile, in that order.
    this.client = client ?? new Anthropic();
  }

  /** Free-text generation. Used where the output is prose the user will read. */
  async text(options: CallOptions): Promise<CallResult<string>> {
    const { text, usage, latencyMs, generationId } = await this.call(options, undefined);
    void usage;
    void latencyMs;
    return { value: text, generationId };
  }

  /**
   * Structured generation. The schema constrains the model's output format via
   * `output_config.format`, and is *also* validated client-side — a constrained
   * decode still can't guarantee the semantics we want (a non-empty persona, a
   * roadmap element with a rationale), and a malformed artifact is much cheaper
   * to catch here than three layers downstream.
   */
  async structured<S extends z.ZodType>(
    options: CallOptions,
    schema: S,
  ): Promise<CallResult<z.infer<S>>> {
    const { text, generationId } = await this.call(options, schema);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LlmSchemaError("Model returned output that is not valid JSON.", text);
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new LlmSchemaError(
        `Model output did not match the expected schema: ${result.error.message}`,
        text,
      );
    }

    return { value: result.data, generationId };
  }

  private async call(
    options: CallOptions,
    schema: z.ZodType | undefined,
  ): Promise<{ text: string; usage: unknown; latencyMs: number; generationId: string }> {
    const startedAt = Date.now();

    const auditInputs = {
      system: options.system,
      prompt: options.prompt,
      effort: options.effort ?? "high",
      ...options.auditInputs,
    };

    try {
      const response = await this.client.beta.messages.create({
        model: MODEL,
        // Thinking is on by default on this model and max_tokens caps thinking
        // plus response text together, so this needs real headroom.
        max_tokens: options.maxTokens ?? 16000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: options.effort ?? "high",
          ...(schema
            ? {
                format: {
                  type: "json_schema" as const,
                  schema: zodToJsonSchema(schema, { target: "openApi3" }),
                },
              }
            : {}),
        },
        // A safety classifier declining a legitimate request would otherwise
        // surface to the user as a broken feature. "default" routes by refusal
        // category rather than pinning a model we would have to migrate later.
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        system: [
          {
            type: "text",
            text: options.system,
            // The stable prefix. Volatile content lives in `prompt`, after this
            // breakpoint, so the cache survives across calls.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: options.prompt }],
      });

      const latencyMs = Date.now() - startedAt;

      if (response.stop_reason === "refusal") {
        const category =
          (response.stop_details as { category?: string } | null)?.category ?? null;
        await this.recordGeneration({
          ...this.base(options),
          inputs: auditInputs,
          latencyMs,
          error: `refusal:${category ?? "unknown"}`,
        });
        throw new LlmRefusalError(category);
      }

      const text = response.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("");

      // max_tokens truncation produces output that parses but is missing its
      // tail — worth failing loudly rather than persisting a half-written post.
      if (response.stop_reason === "max_tokens") {
        await this.recordGeneration({
          ...this.base(options),
          inputs: auditInputs,
          output: text,
          latencyMs,
          error: "max_tokens",
        });
        throw new LlmSchemaError(
          "Model output was truncated at max_tokens. Raise maxTokens for this call.",
          text,
        );
      }

      const generation = await this.recordGeneration({
        ...this.base(options),
        inputs: auditInputs,
        output: text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs,
      });

      return { text, usage: response.usage, latencyMs, generationId: generation.id };
    } catch (err) {
      if (err instanceof LlmRefusalError || err instanceof LlmSchemaError) throw err;

      await this.recordGeneration({
        ...this.base(options),
        inputs: auditInputs,
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private base(options: CallOptions) {
    return {
      userId: options.userId,
      purpose: options.purpose,
      promptName: options.promptName,
      promptVersion: options.promptVersion,
      model: MODEL,
    };
  }
}
