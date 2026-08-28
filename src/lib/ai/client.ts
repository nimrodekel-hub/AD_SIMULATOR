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
  mock,
}: StructuredRequest<T>): Promise<T> {
  if (config.anthropic.mock && mock) return mock();

  const response = await anthropic().messages.parse({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system,
    messages,
    output_config: {
      effort,
      format: zodOutputFormat(schema),
    },
  });

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
  /** Canned reply for keyless operation — see `StructuredRequest.mock`. */
  mock?: string;
}

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
          system,
          messages,
          output_config: { effort },
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
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
