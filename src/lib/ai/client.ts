import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config, modelFor } from "../config";

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
 * Dollars per million tokens, for the estimate in the log line only.
 *
 * A snapshot, not a source of truth: prices change, and the invoice is what is
 * actually charged. It is here because a token count is not a decision — a
 * designer asking "would a cheaper model be worth it" needs to know what this
 * call costs today, and four numbers per line do not answer that. An unknown
 * model simply prints no estimate rather than a wrong one.
 */
const RATES: Record<string, { in: number; out: number }> = {
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-fable-5-1": { in: 10, out: 50 },
};

/** Cache reads are a tenth of input; a 1-hour write is double it. */
const CACHE_READ = 0.1;
const CACHE_WRITE_1H = 2;

/** What one call cost, in dollars, or null for a model with no known rate. */
function costOf(model: string, usage: Usage): number | null {
  const rate = RATES[model];
  if (!rate) return null;
  const input =
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) * CACHE_READ +
    (usage.cache_creation_input_tokens ?? 0) * CACHE_WRITE_1H;
  return (input * rate.in + usage.output_tokens * rate.out) / 1_000_000;
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
 *
 * The model and the dollar estimate are on the line because the question this
 * log exists to answer is a money question, and answering it from token counts
 * needs a rate card and a calculator. Grepping `[ai:usage]` out of the hosting
 * logs now gives a per-step bill directly.
 */
function reportUsage(
  label: string,
  model: string,
  usage: Usage | null | undefined,
): void {
  if (!usage) return;
  const cost = costOf(model, usage);
  console.log(
    `[ai:usage] ${label} model=${model} in=${usage.input_tokens} ` +
      `cached=${usage.cache_read_input_tokens ?? 0} ` +
      `written=${usage.cache_creation_input_tokens ?? 0} ` +
      `out=${usage.output_tokens}` +
      (cost === null ? "" : ` cost=$${cost.toFixed(4)}`),
  );
}

/**
 * The system prompt, split into separately cacheable blocks.
 *
 * Caching is a prefix match, so the order is the design: put what never changes
 * first and what varies last, and each block gets its own read point. The
 * interview sends two — instructions and generic background, identical for
 * every system in the app, then this system's profile — so the large constant
 * half is paid for once across every conversation anyone has, and only the
 * profile is cached per-system.
 *
 * The hour-long lifetime is chosen for the interview, where the expert takes
 * minutes to write each answer and a five-minute entry would be cold by the
 * next turn.
 */
function cacheableSystem(system: string | string[]): Anthropic.TextBlockParam[] {
  const blocks = (Array.isArray(system) ? system : [system]).filter(
    (text) => text.trim().length > 0,
  );

  // Four breakpoints per request is the hard limit, and the growing message
  // tail claims one. Anything past that is silently wasted, so refuse to
  // generate it rather than let a fourth block quietly stop caching.
  if (blocks.length > 3) {
    throw new Error(
      `A prompt may carry at most 3 cached system blocks; got ${blocks.length}.`,
    );
  }

  return blocks.map((text) => ({
    type: "text",
    text,
    cache_control: { type: "ephemeral", ttl: "1h" },
  }));
}

let client: Anthropic | undefined;

function anthropic(): Anthropic {
  if (!config.anthropic.apiKey) {
    throw new AiNotConfiguredError();
  }
  if (!client) {
    client = new Anthropic({
      apiKey: config.anthropic.apiKey,
      // The retry policy lives in `withRetry` below rather than here. The SDK's
      // own default is three quick attempts a second or two apart, which is
      // exactly the wrong shape for an overload: a provider that is saturated
      // now is still saturated two seconds later, so all three attempts are
      // spent inside the same bad moment and the caller sees the failure
      // anyway. Waiting properly is the only thing that helps, and only the
      // code that knows how long it is allowed to wait can do that.
      maxRetries: 0,
    });
  }
  return client;
}

/* ------------------------------------------------------------------ */
/* Riding out a bad minute                                             */
/* ------------------------------------------------------------------ */

/**
 * Whether a failure is worth trying again, or is the answer.
 *
 * Overload (529) and rate limiting are the provider saying "not now" rather
 * than "no": the same request a minute later usually succeeds. Connection
 * faults and 5xx are the same kind of thing. Everything else — a rejected key,
 * a malformed request, a refusal — will fail identically however many times it
 * is sent, and retrying it only makes the user wait longer to be told.
 */
function worthRetrying(reason: unknown): boolean {
  if (reason instanceof Anthropic.RateLimitError) return true;
  if (reason instanceof Anthropic.APIConnectionError) return true;
  if (reason instanceof Anthropic.APIError) {
    return typeof reason.status === "number" && reason.status >= 500;
  }
  return false;
}

/**
 * How long to wait before each further attempt, in seconds.
 *
 * Deliberately long. These calls already run server-side inside a five-minute
 * budget with the browser polling a job record, so nobody is holding a
 * connection open and a two-minute recovery costs the designer nothing but
 * patience they were already spending. Short retries would be free and useless
 * — an overload lasts longer than a second.
 */
const BACKOFF_S = [3, 10, 25, 60];

/**
 * Runs a call, and keeps trying while the provider is merely busy.
 *
 * This exists because of a real report: a designer asked for a correction to
 * an exercise and got `Anthropic API error 529 overloaded_error` back, which is
 * not a fault in their request and not something they can do anything about.
 * The work was already running in the background with nothing waiting on it,
 * so the right response was to wait and go again rather than to hand a
 * provider's bad minute to the person using the app.
 */
async function withRetry<T>(
  label: string,
  call: () => Promise<T>,
  /**
   * Asked before each further attempt. Streaming uses it: once a word has
   * reached the browser the reply cannot be started over, because going again
   * would splice a second answer onto the end of half of the first.
   */
  stillSafe: () => boolean = () => true,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= BACKOFF_S.length; attempt += 1) {
    try {
      return await call();
    } catch (reason) {
      last = reason;
      const wait = BACKOFF_S[attempt];
      if (wait === undefined || !worthRetrying(reason) || !stillSafe()) {
        throw reason;
      }
      /* The log wants what happened, not the sentence shown to the designer:
         that one says the call was already retried for a minute, which is not
         yet true on the first go round. */
      const what =
        reason instanceof Anthropic.APIError
          ? `${reason.status} ${apiErrorText(reason)}`
          : reason instanceof Error
            ? reason.message
            : "unknown";
      console.log(
        `[ai:retry] ${label} attempt ${attempt + 1} failed (${what}) ` +
          `— trying again in ${wait}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    }
  }
  throw last;
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

/** Whether the provider said it is saturated, whatever shape it said it in. */
function isOverloaded(reason: unknown): boolean {
  if (!(reason instanceof Anthropic.APIError)) return false;
  if (reason.status === 529) return true;
  const body = reason.error as { error?: { type?: string } } | undefined;
  return body?.error?.type === "overloaded_error";
}

/** The provider's own sentence, without the status and JSON wrapper. */
function apiErrorText(reason: InstanceType<typeof Anthropic.APIError>): string {
  const body = reason.error as { error?: { message?: string } } | undefined;
  const inner = body?.error?.message;
  if (inner && inner.trim().length > 0) return inner;
  return reason.message.replace(/^\s*\d{3}\s*/, "");
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
    return (
      "The Anthropic API is rate-limiting this account. It was retried for " +
      "over a minute and was still limited. Wait a few minutes and press it " +
      "again — nothing was lost."
    );
  }
  if (isOverloaded(reason)) {
    return (
      "The Anthropic API is overloaded at the moment. That is on their side, " +
      "not a problem with what you asked for. It was already retried for over " +
      "a minute; press it again and it will usually go through."
    );
  }
  if (reason instanceof Anthropic.APIConnectionError) {
    return "Could not reach the Anthropic API. Press it again in a moment.";
  }
  if (reason instanceof Anthropic.APIError) {
    /* The SDK's own message is the raw response body, which begins with the
       status — printing both gives "529: 529 {...json...}". Prefer whatever
       sentence the provider put inside the envelope. */
    return `Anthropic API error ${reason.status}: ${apiErrorText(reason)}`;
  }
  return reason instanceof Error ? reason.message : "Unexpected error calling the AI.";
}

/* ------------------------------------------------------------------ */
/* Structured output                                                   */
/* ------------------------------------------------------------------ */

export interface StructuredRequest<T> {
  /** One block, or several ordered stable-to-variable for caching. */
  system: string | string[];
  messages: Anthropic.MessageParam[];
  schema: z.ZodType<T>;
  /**
   * How hard the model should think. Extraction and evaluation are judgement
   * calls and get "high"; mechanical rendering work gets less.
   */
  effort?: Effort;
  maxTokens?: number;
  /**
   * Names this call in the usage log, so spend can be attributed to a step —
   * and chooses which model runs it, via `modelFor`.
   */
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

  const model = modelFor(label);
  const response = await withRetry(label, () =>
    anthropic().messages.parse({
      model,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      system: cacheableSystem(system),
      messages,
      output_config: {
        effort,
        format: zodOutputFormat(schema),
      },
    }),
  );

  reportUsage(label, model, response.usage as Usage);

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
  /** One block, or several ordered stable-to-variable for caching. */
  system: string | string[];
  messages: Anthropic.MessageParam[];
  effort?: Effort;
  maxTokens?: number;
  /**
   * Names this call in the usage log, so spend can be attributed to a step —
   * and chooses which model runs it, via `modelFor`.
   */
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
  const model = modelFor(label);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (canned !== undefined) {
          controller.enqueue(encoder.encode(canned));
          controller.close();
          return;
        }

        // Keep the connection warm while the model is still thinking, and
        // across any wait for an overloaded provider to recover. Stopped as
        // soon as real text starts, so nothing is ever injected into the
        // middle of a sentence — which is also why it spans the retries: the
        // silence during a sixty-second backoff is exactly the silence a phone
        // reads as a dead connection.
        let wroteText = false;
        const keepAlive = setInterval(() => {
          if (!wroteText) controller.enqueue(encoder.encode(" "));
        }, SILENCE_LIMIT_MS);

        try {
          await withRetry(
            label,
            async () => {
              const stream = anthropic().messages.stream({
                model,
                max_tokens: maxTokens,
                thinking: { type: "adaptive" },
                system: cacheableSystem(system),
                messages,
                output_config: { effort },
                // A conversation re-sends everything said so far on every
                // single turn, so its cost grows with the square of its
                // length. Caching the growing tail as well as the system
                // prompt is what stops that: the breakpoint moves forward by
                // itself as turns are appended, so each turn pays full price
                // only for what was just added.
                cache_control: { type: "ephemeral" },
              });

              for await (const event of stream) {
                if (
                  event.type === "content_block_delta" &&
                  event.delta.type === "text_delta"
                ) {
                  wroteText = true;
                  controller.enqueue(encoder.encode(event.delta.text));
                }
              }

              reportUsage(label, model, (await stream.finalMessage()).usage as Usage);
            },
            () => !wroteText,
          );
        } finally {
          clearInterval(keepAlive);
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
