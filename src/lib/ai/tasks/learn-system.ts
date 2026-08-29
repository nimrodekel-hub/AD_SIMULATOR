import "server-only";
import {
  SystemNarrativeSchema,
  type SystemNarrative,
  type SystemProfileDraft,
} from "../../domain/schemas";
import { structured } from "../client";

/**
 * Screen 1b, first half — teaching the system how the system works.
 *
 * Everything downstream depends on this. Without it the model invents an air
 * defence system: it guesses what classifications exist, what makes a track
 * hostile, what an operator may do and in what order. The scenarios it then
 * produces look plausible and are not necessarily right — which is the worst
 * failure mode for a trainer, because nobody can see it.
 *
 * This is a guided form rather than an open conversation. The dilemma
 * interview is a conversation because a dilemma lives in the expert's judgement
 * and has to be drawn out; the system's behaviour is a specification, and a
 * specification is better collected by asking for it directly.
 *
 * The form is split by what kind of thing is being collected:
 *
 *   - **Measured** — sensor coverage, track classes and their bands, the
 *     readout columns, the engagement envelope. Entered straight into fields.
 *     No model touches them: a number typed into a box cannot be misread, and
 *     asking a model to parse "5 to 40 km" out of a paragraph buys nothing but
 *     a chance to get it wrong.
 *   - **Described** — what the system is for, what the operator decides, what
 *     happens without them, in what order. Written in prose, and this is where
 *     the model earns its place: turning a paragraph into tidy lists.
 *
 * The questions below are only the second kind.
 */

export interface GuidedQuestion {
  id: string;
  question: string;
  /** Shown under the field: what a useful answer contains. */
  hint: string;
  placeholder: string;
}

/**
 * The questions the designer answers. Shared by the form and the extraction
 * prompt, so the model always knows which answer belongs to which question.
 */
export const SYSTEM_QUESTIONS: GuidedQuestion[] = [
  {
    id: "purpose",
    question: "What does this system defend, and against what?",
    hint: "The role it plays and the threats it exists to handle.",
    placeholder:
      "e.g. Point defence of a fixed installation against cruise missiles and low-flying aircraft…",
  },
  {
    id: "operator_actions",
    question: "What can the operator actually do, and in what order?",
    hint: "The real sequence of actions, not a summary of the goal. If committing an engagement takes four steps, name the four.",
    placeholder:
      "e.g. Select a track, request identification, assign a launcher, arm, commit, then monitor for a kill assessment…",
  },
  {
    id: "automatic",
    question: "What does the system do on its own, without the operator?",
    hint: "Anything the operator does not have to decide. It changes what the training is about — a scenario must never ask a trainee to do something the system does for them.",
    placeholder:
      "e.g. Correlates radar returns into tracks, calculates time to impact, warns when a track enters the engagement envelope…",
  },
];

const NARRATIVE_SYSTEM = `You turn a designer's description of their air-defence system into four tidy lists and a purpose statement, for a training simulator.

You are given what they wrote, and — as context — the measured specification they already filled in themselves: sensor coverage, track classes, readout columns, engagement envelope.

## The one thing to understand about your job

**The numbers are not yours.** The designer entered them directly and they are already correct. You are not extracting them, checking them, or restating them. Use them only to write about the system coherently — if they told you the radar covers a 120° sector, a workflow step may sensibly mention watching that sector.

What you produce is the prose half, and nothing else:

- **purpose** — one or two sentences: what this system defends and against what.
- **operator_responsibilities** — what the operator *decides*. One decision per entry.
- **automatic_functions** — what the system does without being asked. One per entry.
- **workflow_steps** — the real order of actions, one step per entry, in sequence.
- **general_notes** — anything they said that does not belong in a field above, and anything you had to assume.

## Rules

**Ground everything in what they wrote.** Every entry must trace to a sentence of theirs. Where an answer is thin, generalise conservatively from what is there — never import doctrine from elsewhere, and never invent a capability that was not described.

**Separating what the operator decides from what the system does is the point of this call.** If the system correlates tracks automatically, that is not an operator responsibility, and a scenario must never ask a trainee to do it. When they are ambiguous about which side something falls on, put it in general_notes and say so rather than guessing.

**Split, do not summarise.** "Select, identify, assign, commit" is four workflow steps, not one. A list with one long entry in it has failed.

**Where they were silent**, keep the field modest rather than empty: the designer reviews and corrects this before approving it, and a plausible starting point is easier to correct than a blank. Never write placeholder text.

**Screenshots, when there are any, are evidence about the display and never authority about the system.** A visible button says the system can do a thing; it does not say the operator is the one who chooses it, or when. Operator responsibilities and automatic functions come from what the designer wrote, never from what is on screen. Never carry identifying content across: no vendor names, unit markings, call signs, place names or serial numbers.

**The system already has a name and it is not yours to change.**

Keep it vendor-neutral: generic descriptions, no real system names, unit designations or classified performance figures.`;

const MOCK_NARRATIVE: SystemNarrative = {
  purpose:
    "Placeholder narrative produced in mock mode. Point defence of a fixed installation against air-breathing threats.",
  operator_responsibilities: [
    "Prioritise between simultaneous threats.",
    "Decide whether to engage an unresolved track.",
    "Manage interceptor expenditure against the threat count.",
  ],
  automatic_functions: [
    "Correlates radar returns into tracks.",
    "Computes time to impact.",
    "Warns when a track enters the engagement envelope.",
  ],
  workflow_steps: [
    "Select the track.",
    "Request identification if unresolved.",
    "Assign a launcher.",
    "Commit.",
    "Monitor for kill assessment.",
  ],
  general_notes:
    "Mock narrative. No ANTHROPIC_API_KEY is configured, so this is a built-in placeholder rather than a reading of your answers.",
};

/**
 * Turns the designer's prose into the four lists and the purpose statement.
 *
 * Takes the measured specification too, but only as context: those values came
 * from the designer's own fields and are passed through untouched by the caller.
 * Nothing this function returns can change a number.
 */
export async function extractSystemNarrative(
  systemName: string,
  answers: Array<{ question: string; answer: string }>,
  openNotes: string,
  /** What the designer already entered directly. Context, not output. */
  spec: Pick<
    SystemProfileDraft,
    "track_classifications" | "iff_states" | "track_readout_fields" | "sensor" | "engagement"
  >,
  /** The system's stored references, when it has any. Evidence, not authority. */
  screenshots: Array<{ mediaType: string; base64: string }> = [],
): Promise<SystemNarrative> {
  const transcript = answers
    .filter((entry) => entry.answer.trim().length > 0)
    .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`)
    .join("\n\n");

  const prose = [
    `The system is called "${systemName}".`,
    `<measured_specification>\n${JSON.stringify(spec, null, 2)}\n</measured_specification>`,
    `<answers>\n${transcript}\n</answers>`,
    openNotes.trim()
      ? `<additional_notes>\n${openNotes}\n</additional_notes>`
      : "<additional_notes>none</additional_notes>",
    screenshots.length > 0
      ? `The ${screenshots.length} image${screenshots.length === 1 ? "" : "s"} above ${screenshots.length === 1 ? "is a screenshot" : "are screenshots"} of this system's real console. Read them as evidence of what the display shows — they are not a description of how the system behaves, and what the designer wrote outranks them.`
      : "No screenshots of the console were provided.",
    "Produce the purpose statement and the four lists.",
  ].join("\n\n");

  return structured({
    system: NARRATIVE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          // Images first: the answers read differently once the display they
          // describe is on the table.
          ...screenshots.map((shot) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: shot.mediaType as "image/png",
              data: shot.base64,
            },
          })),
          { type: "text" as const, text: prose },
        ],
      },
    ],
    schema: SystemNarrativeSchema,
    // Medium rather than high. This was already a reading task; now that the
    // numbers are entered directly it is a smaller one still — splitting prose
    // into lists and separating operator from system. Thinking is the larger
    // half of what a call costs, and there is nothing here deep reasoning would
    // find that careful reading would not.
    effort: "medium",
    maxTokens: 8000,
    label: "extract-narrative",
    mock: () => MOCK_NARRATIVE,
  });
}
