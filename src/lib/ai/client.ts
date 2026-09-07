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
  "claude-fable-5-1": { in: 10, out: 50 },
  "claude-fable-5": { in: 10, out: 50 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-opus-4-8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
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
 * Whether a failure is the answer being cut off rather than anything wrong.
 *
 * The SDK parses the reply against the schema and throws its own error when
 * the JSON will not parse — which, on a truncated reply, is a message about a
 * character offset. Matched on text rather than on a class because the SDK
 * raises a plain `Error` for it, and the alternative is showing a designer
 * `Unterminated string in JSON at position 6654` after a three-minute wait.
 */
function ranOutOfRoom(reason: unknown): boolean {
  const said = reason instanceof Error ? reason.message : String(reason);
  return (
    /failed to parse structured output/i.test(said) ||
    /unterminated string|unexpected end of (json|input)/i.test(said)
  );
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

/**
 * Whether the account has run out of credit.
 *
 * It arrives as a plain 400, which put it in the same bucket as a malformed
 * request — so the app reported an API error and left a designer looking for
 * the mistake in what they had typed. There is no mistake, and no amount of
 * rewording fixes it: it is a billing state, and the only useful thing to say
 * is where to go and top it up.
 */
function isOutOfCredit(reason: unknown): boolean {
  if (!(reason instanceof Anthropic.APIError)) return false;
  if (reason.status !== 400) return false;
  return /credit balance is too low/i.test(apiErrorText(reason));
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
  if (isOutOfCredit(reason)) {
    return (
      "The Anthropic account is out of credit, so nothing can be generated — " +
      "interviews, exercises, consoles and debriefs all stop until it is topped " +
      "up. Nothing here is wrong with what you asked for, and nothing was lost. " +
      "Add credit under Plans & Billing in the Anthropic console, then press it " +
      "again."
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
/* Declined requests                                                   */
/* ------------------------------------------------------------------ */

/**
 * Asks the API to re-run a policy-declined request on a substitute model.
 *
 * This app writes air-defence engagements: silent inbound tracks, engagement
 * envelopes, when an operator may fire. That is exactly the shape of content a
 * safety classifier can decline, and until now a decline arrived as a dead end
 * — "the model declined this request", mid-way through a trainee starting a
 * run or a designer correcting an exercise, with nothing to do about it.
 *
 * `"default"` rather than a named substitute: which model is the right one
 * depends on *why* the request was declined, the routing is decided
 * server-side, and naming one would leave a migration owing the day it is
 * retired.
 */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Whether this account can use the fallback beta. Null until it has been tried.
 *
 * The opt-in must never be the thing that breaks the app. It is a beta, and a
 * beta an organisation is not enrolled in is rejected — so the first rejection
 * turns it off for the life of the process and the call goes again without it.
 * A robustness feature that can take every AI call down with it is not one.
 */
let fallbacksUsable: boolean | null = null;

/** Whether a 400 is the account refusing the beta rather than a bad request. */
function rejectedTheBeta(reason: unknown): boolean {
  if (!(reason instanceof Anthropic.APIError)) return false;
  if (reason.status !== 400) return false;
  const text = apiErrorText(reason).toLowerCase();
  return text.includes("fallback") || text.includes("beta");
}

/** The parts of a reply this app reads, from either the beta or plain path. */
interface Parsed<T> {
  parsed_output: T | null | undefined;
  stop_reason: string | null;
  refusalCategory: string | null;
  usage: Usage;
  /** The model that actually answered — not always the one asked for. */
  served: string;
}

/* ------------------------------------------------------------------ */
/* Structured output                                                   */
/* ------------------------------------------------------------------ */

/**
 * The room every structured call gets, whatever it asked for.
 *
 * Enough for the thinking and the answer together on the largest thing this
 * app writes — a full exercise with its track list — with a wide margin,
 * because the margin is free and being wrong in the other direction throws
 * away the whole reply and everything paid for it.
 */
const ROOM_ENOUGH = 64000;

/**
 * The ceiling used for the one automatic second attempt at a cut-off reply.
 *
 * 128k is the documented maximum for a single reply from the models this app
 * runs, and it is only reachable on a streaming request — which every call
 * here is. Like any ceiling it costs nothing unless it is used.
 */
const ROOMIER = 128000;

/**
 * What is said when even `ROOMIER` was not enough.
 *
 * Two attempts at the largest reply the model can write is where "the
 * allowance is too small" stops being a plausible explanation, so this is the
 * one point at which asking for something smaller is the honest advice rather
 * than a way of handing a mechanical problem to the person who paid for it.
 */
const TWICE_OVER =
  "The model ran out of room writing this one twice over, the second time " +
  "with the largest reply it can produce — so the request itself is too big " +
  "rather than the allowance too small. Nothing was saved. Ask for a smaller " +
  "one: fewer tracks, or a shorter brief.";

/** Whether a 400 is the API refusing the ceiling as larger than the model's. */
function tooMuchRoom(reason: unknown): boolean {
  if (!(reason instanceof Anthropic.APIError)) return false;
  if (reason.status !== 400) return false;
  return /max_tokens/i.test(apiErrorText(reason));
}

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
  /**
   * The ceiling on one reply — **and the thinking counts against it.**
   *
   * That last part is the whole story of a bug that cost real money for
   * nothing, twice, and it is worth spelling out because the number looks
   * innocent. Adaptive thinking is billed and budgeted out of `max_tokens`,
   * so a ceiling is not "how long may the answer be" but "how much room is
   * there for thinking *plus* answer". Every task in this app used to set its
   * own tight ceiling — 16k, 8k, 4k — chosen by looking at how big the JSON
   * was. At `effort: "high"` the thinking alone can run past that, and what
   * arrives is the first page of a JSON document with the rest missing:
   *
   *     Unterminated string in JSON at position 6654
   *
   * 6654 characters is about 1,700 tokens. Nothing was near "too long to
   * write"; the room had already been spent before the writing started.
   *
   * So a task no longer gets to choose. Whatever a caller passes is treated
   * as a *floor* and raised to `ROOM_ENOUGH` — which is why the callers that
   * still pass 16000 or 4000 are harmless: those numbers no longer decide
   * anything. They are left in place only because this repository is edited
   * through an API that rewrites whole files rather than diffs, so deleting
   * six one-line properties would cost 124 KB of transport to change no
   * behaviour at all. They go when those files are next opened for a real
   * reason.
   *
   * Leaving the real ceiling high is free: an unused ceiling is not charged
   * for. Only the tokens actually spent are. And `roomier` below raises it
   * once more if a reply still comes back cut off.
   *
   * Why it can be this high: a request that waits for the whole reply in one
   * piece cannot go much past 16k before the HTTP request times out.
   * Streaming removes that limit, which is why the calls below stream and
   * take the final message rather than asking for it whole.
   */
  maxTokens = 0,
  label = "structured",
  mock,
}: StructuredRequest<T>): Promise<T> {
  if (config.anthropic.mock && mock) return mock();

  const model = modelFor(label);
  /* The floor, applied. See `maxTokens` above for why a caller's number is
     never taken as an upper bound. */
  const room = Math.max(maxTokens, ROOM_ENOUGH);
  const requestWith = (ceiling: number) => ({
    model,
    max_tokens: ceiling,
    thinking: { type: "adaptive" as const },
    system: cacheableSystem(system),
    messages,
    output_config: {
      effort,
      format: zodOutputFormat(schema),
    },
  });

  /* Ask for the fallback, and take it off the table for good the first time
     the account says no — see `fallbacksUsable`. */
  const ask = async (ceiling: number): Promise<Parsed<T>> => {
    const request = requestWith(ceiling);
    if (fallbacksUsable !== false) {
      try {
        const beta = await anthropic()
          .beta.messages.stream({
            ...request,
            betas: [FALLBACK_BETA],
            fallbacks: "default",
          })
          .finalMessage();
        fallbacksUsable = true;
        return {
          parsed_output: beta.parsed_output as T | null | undefined,
          stop_reason: beta.stop_reason,
          refusalCategory: beta.stop_details?.category ?? null,
          usage: beta.usage as Usage,
          served: beta.model,
        };
      } catch (reason) {
        if (!rejectedTheBeta(reason)) throw reason;
        fallbacksUsable = false;
        console.log(
          "[ai:fallbacks] this account cannot use " +
            `${FALLBACK_BETA}; carrying on without it`,
        );
      }
    }

    const plain = await anthropic().messages.stream(request).finalMessage();
    return {
      parsed_output: plain.parsed_output as T | null | undefined,
      stop_reason: plain.stop_reason,
      refusalCategory: plain.stop_details?.category ?? null,
      usage: plain.usage as Usage,
      served: plain.model,
    };
  };

  /**
   * Running out of room is not the designer's problem to solve.
   *
   * It used to be reported as one: an error, nothing saved, and the advice to
   * "ask for a smaller one" — which put the cost of a bad ceiling on the
   * person who had just paid for it and had no way of knowing what a ceiling
   * was. A cut-off reply is a mechanical failure with a mechanical remedy, so
   * it is taken once, here, without asking: the same request again with twice
   * the room.
   *
   * Once, and only on this failure. A ceiling that 128k does not clear is not
   * a ceiling problem, and retrying a genuinely runaway request is how a
   * wasted 50 cents becomes a wasted five dollars.
   */
  const roomier = async (why: string): Promise<Parsed<T>> => {
    console.log(
      `[ai:roomier] ${label} came back cut off (${why}) at max_tokens=` +
        `${room}; asking again with ${ROOMIER}`,
    );
    try {
      return await withRetry(label, () => ask(ROOMIER));
    } catch (reason) {
      /* `ROOMIER` is the maximum for the model this app is configured to run.
         Point a deployment at a smaller model and the API refuses the number
         outright — which is a configuration answer, not something to ask the
         designer to reword. */
      if (tooMuchRoom(reason)) {
        throw new Error(
          `This reply came back cut off, and ${model} cannot be given more ` +
            "room than it already had. Nothing was saved. Either ask for a " +
            "smaller one — fewer tracks, or a shorter brief — or configure a " +
            "model with a larger reply limit.",
        );
      }
      if (ranOutOfRoom(reason)) throw new Error(TWICE_OVER);
      throw reason;
    }
  };

  let response: Parsed<T>;
  try {
    response = await withRetry(label, () => ask(room));
  } catch (reason) {
    /* The reply is a JSON document, so being cut off is not a short answer —
       it is a broken one, and the SDK's own parser is what notices, throwing
       before there is a `stop_reason` to look at. Its message names a
       character offset, which tells nobody anything; what it means is that
       the room ran out. */
    if (!ranOutOfRoom(reason)) throw reason;
    response = await roomier("the reply would not parse");
  }

  if (response.stop_reason === "max_tokens") {
    // The same failure caught before the parser rather than after — and this
    // time the model said so itself.
    reportUsage(label, response.served, response.usage);
    response = await roomier("the model said max_tokens");
  }

  // The model that answered, not the one asked for: a fallback bills at its
  // own rates, so logging the requested model would misprice the line.
  reportUsage(label, response.served, response.usage);

  if (response.stop_reason === "max_tokens") {
    /* Twice, at 128k. Whether the JSON happens to be parseable at that point
       is luck, so it is refused either way rather than saved as a half-written
       exercise. */
    throw new Error(TWICE_OVER);
  }

  if (response.stop_reason === "refusal") {
    throw new Error(
      "The model declined to write this one" +
        (response.refusalCategory ? ` (${response.refusalCategory})` : "") +
        ". A substitute was tried and declined it too. Reword the operational " +
        "detail — it is usually one specific phrase rather than the whole request.",
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
  maxTokens = 0,
  label = "chat",
  mock,
}: StreamRequest): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const canned = config.anthropic.mock ? mock : undefined;
  const model = modelFor(label);
  /* A floor, for the same reason as in `structured`: the thinking is spent out
     of this allowance, so a tight one does not shorten the answer — it cuts
     it. Prose survives that better than JSON does, which is exactly why it
     went unnoticed here: a reply that stops mid-sentence still looks like a
     reply. */
  const room = Math.max(maxTokens, ROOM_ENOUGH);

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
                max_tokens: room,
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

              const finished = await stream.finalMessage();
              reportUsage(label, finished.model, finished.usage as Usage);
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
