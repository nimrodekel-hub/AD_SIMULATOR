import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config } from "../config";

/**
 * The single place that talks to the Anthropic API.
 *
 * Every AI feature in this app is one of two shapes: "give me a validated
 * object" (`structured`) or "stream prose to the browser" (`streamChat`). Task
 * modules under lib/ai/tasks own the prompts; this file owns the transport.
 */

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** What one call actually consumed. The only ground truth about cost. */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/**
 * Records what a call cost, so that "why is the bill this size" is answerable.
 *
 * Output tokens include the model's thinking, which is invisible in the reply
 * and is usually the larger half of the bill on a conversational call. Without
 * this line there is no way to see that from inside the app.
 *
 * `input_tokens` is the *uncached remainder* only — the full prompt is the sum
 * of all three input figures. A healthy cached turn shows a large `cached` and
 * a small `in`.
 */
function reportUsage(label: string, usage: Usage | null | undefined): void {
  if (!usage) return;
  console.log(
    `[ai:usage] ${label} in=${usage.input_tokens} ` +
      `cached=${usage.cache_read_input_tokens ?? 0} ` +
      `written=${usage.cache_creation_input_tokens ?? 0} ` +
      `out=${usage.output_tokens}`,
  );
}

/**
 * Everything the model is told that does not change between calls.
 *
 * Marked for caching: it sits at the very front of every prompt, so it is the
 * one part that can be paid for once and read back cheaply. The hour-long
 * lifetime is chosen for the interview, where the expert takes minutes to write
 * each answer and a five-minute entry would be cold by the next turn.
 */
function cacheableSystem(system: string): Anthropic.TextBlockParam[] {
  return [
    {
      type: "text",
      text: system,
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ];
}

let client: Anthropic | undefined;

function anthropic(): Anthropic {
  if (!config.anthropic.apiKey) {
    throw new AiNotConfiguredError();
  }
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return client;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local for local development, " +
        "or to the project's environment variables in Vercel.",
    );
    this.name = "AiNotConfiguredError";
  }
}

/**
 * Turns SDK failures into messages a domain expert can act on. Without this the
 * UI shows raw provider errors, and "400 invalid_request_error" tells the user
 * nothing about what to do next.
 */
export function describeAiError(reason: unknown): string {
  if (reason instanceof AiNotConfiguredError) return reason.message;
  if (reason instanceof Anthropic.AuthenticationError) {
    return "The Anthropic API key was rejected. Check that ANTHROPIC_API_KEY is correct and active.";
  }
  if (reason instanceof Anthropic.RateLimitError) {
    return "Rate limited by the Anthropic API. Wait a few seconds and try again.";
  }
  if (reason instanceof Anthropic.APIError) {
    return `Anthropic API error ${reason.status}: ${reason.message}`;
  }
  return reason instanceof Error ? reason.message : "Unexpected error calling the AI.";
}

/* ------------------------------------------------------------------ */
/* Structured output                                                   */
/* ------------------------------------------------------------------ */

export interface StructuredRequest<T> {
  system: string;
  messages: Anthropic.MessageParam[];
  schema: z.ZodType<T>;
  /**
   * How hard the model should think. Extraction and evaluation are judgement
   * calls and get "high"; mechanical rendering work gets less.
   */
  effort?: Effort;
  maxTokens?: number;
  /** Names this call in the usage log, so spend can be attributed to a step. */
  label?: string;
  /**
   * Canned result used when the app runs without an API key, so the screens can
   * be clicked through end-to-end before one is configured. Never consulted
   * when a key is present.
   */
  mock?: () => T;
}

/**
 * Asks Claude for a value matching `schema` and returns it already validated.
 *
 * Uses structured outputs rather than "reply with JSON" plus a parser: the
 * schema constrains generation itself, so a malformed or half-invented object
 * is not something the caller has to defend against.
 */
export async function structured<T>({
  system,
  messages,
  schema,
  effort = "high",
  maxTokens = 16000,
  label = "structured",
  mock,
}: StructuredRequest<T>): Promise<T> {
  if (config.anthropic.mock && mock) return mock();

  const response = await anthropic().messages.parse({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system: cacheableSystem(system),
    messages,
    output_config: {
      effort,
      format: zodOutputFormat(schema),
    },
  });

  reportUsage(label, response.usage as Usage);

  if (response.stop_reason === "refusal") {
    throw new Error(
      `The model declined this request (${response.stop_details?.category ?? "unspecified"}). ` +
        "Rephrase the operational detail and try again.",
    );
  }
  if (!response.parsed_output) {
    throw new Error(
      "The model returned a response that did not match the expected structure. Try again.",
    );
  }
  return response.parsed_output;
}

/* ------------------------------------------------------------------ */
/* Streaming prose                                                     */
/* ------------------------------------------------------------------ */

export interface StreamRequest {
  system: string;
  messages: Anthropic.MessageParam[];
  effort?: Effort;
  maxTokens?: number;
  /** Names this call in the usage log, so spend can be attributed to a step. */
  label?: string;
  /** Canned reply for keyless operation — see `StructuredRequest.mock`. */
  mock?: string;
}

/**
 * How long the stream may stay silent before the first word arrives.
 *
 * The model thinks before it writes, and thinking produces no text — so between
 * the headers and the first word the connection carries nothing at all. A phone
 * treats a silent connection as a dead one. A single space every so often costs
 * nothing, is trimmed off before display, and keeps the connection alive
 * through however long the model needs to think.
 */
const SILENCE_LIMIT_MS = 15_000;

/**
 * Streams a conversational reply as plain text chunks.
 *
 * The designer's learning conversation can run long, and waiting in silence for
 * a full paragraph makes the agent feel unresponsive — which matters here,
 * because the whole point of that screen is a fluent back-and-forth.
 */
export function streamChat({
  system,
  messages,
  effort = "high",
  maxTokens = 16000,
  label = "chat",
  mock,
}: StreamRequest): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const canned = config.anthropic.mock ? mock : undefined;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (canned !== undefined) {
          controller.enqueue(encoder.encode(canned));
          controller.close();
          return;
        }

        const stream = anthropic().messages.stream({
          model: config.anthropic.model,
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          system: cacheableSystem(system),
          messages,
          output_config: { effort },
          // A conversation re-sends everything said so far on every single
          // turn, so its cost grows with the square of its length. Caching the
          // growing tail as well as the system prompt is what stops that: the
          // breakpoint moves forward by itself as turns are appended, so each
          // turn pays full price only for what was just added.
          cache_control: { type: "ephemeral" },
        });

        // Keep the connection warm while the model is still thinking. Stopped
        // as soon as real text starts, so nothing is ever injected into the
        // middle of a sentence.
        let wroteText = false;
        const keepAlive = setInterval(() => {
          if (!wroteText) controller.enqueue(encoder.encode(" "));
        }, SILENCE_LIMIT_MS);

        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              wroteText = true;
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
        } finally {
          clearInterval(keepAlive);
        }

        reportUsage(label, (await stream.finalMessage()).usage as Usage);
        controller.close();
      } catch (reason) {
        // Headers are already sent by the time this runs, so the error cannot
        // become a status code — it has to be delivered inside the stream.
        controller.enqueue(
          encoder.encode(`\n\n[error] ${describeAiError(reason)}`),
        );
        controller.close();
      }
    },
  });
}

export type { Anthropic };
