import "server-only";
import {
  MatchResultSchema,
  type ClarificationRound,
  type ScenarioEntry,
  type MatchResult,
} from "../../domain/schemas";
import { structured } from "../client";

/**
 * Screen 3, step 1 — routing a trainee's free-text request to a scenario.
 *
 * This is the call the whole POC exists to test: can a model take "I want to
 * practise deciding what to shoot first when everything arrives at once" and
 * land on the right piece of captured expertise, or correctly admit it is
 * unsure?
 */

/**
 * Below this, the trainee gets a clarifying question instead of an exercise.
 *
 * Set where it is because the failure modes are asymmetric: training on
 * slightly the wrong scenario wastes a session and teaches the wrong lesson,
 * whereas one extra question costs a few seconds.
 */
export const CONFIDENCE_THRESHOLD = 0.6;

/** The brief caps clarification at three rounds; after that we commit. */
export const MAX_CLARIFICATION_ROUNDS = 3;

const MATCHING_SYSTEM = `You route a trainee's free-text training request to the single best-matching scenario in the air-defence knowledge base.

A scenario is a situation with the dilemmas its designer put in it. You are choosing which situation to train, not laying out the exercise — that happens after you.

You will be given the request, any clarifying exchanges that have already happened, and the catalogue of available scenarios with their trigger conditions.

## What to return

- **scenario_entry_id** — the id of the best match, copied exactly from the catalogue. If the catalogue is empty, return an empty string.
- **confidence** — 0.0 to 1.0, calibrated honestly.
- **reasoning** — one sentence naming the specific thing in the request that matches this entry's trigger conditions.
- **clarifying_question** — a single question, only when confidence is low. Empty string otherwise.
- **suggested_difficulty** — inferred from the request's own wording.

## Calibrating confidence

Be honest rather than generous. Report high confidence when the request names the situation, the pressure, or the vocabulary that an entry's trigger conditions describe. Report low confidence when the request is generic ("something challenging", "a hard one"), when it could plausibly fit two entries, or when it describes something the catalogue does not cover.

**A catalogue with only one entry does not make that entry a match.** If the request does not fit it, say so with low confidence — do not inflate the score because there is nothing else to pick.

## Writing the clarifying question

Ask about the thing that actually distinguishes the candidates: the pressure the trainee wants to feel, the situation they want to be in. Never ask them to pick from a list of scenario titles — they have not seen the knowledge base and should not have to.

One question. Short.

## Difficulty

Words like "gentle", "walk me through", "I'm new" mean easy. "Challenging", "under real pressure", "make it hurt" mean hard. Silence means medium.`;

interface MatchInput {
  request: string;
  clarifications: ClarificationRound[];
  scenarios: ScenarioEntry[];
}

export async function matchScenario({
  request,
  clarifications,
  scenarios,
}: MatchInput): Promise<MatchResult> {
  // Only the fields relevant to routing. Sending whole entries would bury the
  // trigger conditions under dilemmas the matcher has no use for.
  const catalogue = scenarios.map((entry) => ({
    id: entry.id,
    title: entry.title,
    sub_domain_tag: entry.sub_domain_tag,
    trigger_conditions: entry.trigger_conditions,
  }));

  const exchanges = clarifications
    .map((round, index) => `Q${index + 1}: ${round.question}\nA${index + 1}: ${round.answer}`)
    .join("\n\n");

  return structured({
    system: MATCHING_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `<trainee_request>\n${request}\n</trainee_request>`,
          exchanges
            ? `<clarifications_so_far>\n${exchanges}\n</clarifications_so_far>`
            : "<clarifications_so_far>none</clarifications_so_far>",
          `<catalogue>\n${JSON.stringify(catalogue, null, 2)}\n</catalogue>`,
        ].join("\n\n"),
      },
    ],
    schema: MatchResultSchema,
    // Medium rather than high. Routing a request to one of a handful of
    // entries is a classification, not a deliberation — it measured at nine
    // seconds against production even at high effort, which is the shape of a
    // task that was not using the extra thinking it was paying for.
    //
    // The safeguard that matters here is not effort but the confidence
    // threshold above: a matcher that is unsure asks rather than guesses, and
    // that behaviour is unchanged.
    effort: "medium",
    maxTokens: 4000,
    label: "match",
    mock: () => ({
      scenario_entry_id: scenarios[0]?.id ?? "",
      confidence: 0.9,
      reasoning: "Mock match — no ANTHROPIC_API_KEY configured, so the first entry is returned.",
      clarifying_question: "",
      suggested_difficulty: "medium" as const,
    }),
  });
}
