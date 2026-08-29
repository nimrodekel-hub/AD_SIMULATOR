import "server-only";
import {
  SystemProfileDraftSchema,
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
    id: "classifications",
    question: "What kinds of tracks appear on the display, and what tells them apart?",
    hint: "Each class an operator distinguishes, and the speed and altitude bands that go with it.",
    placeholder:
      "e.g. Fast air — 400-600 kts, 5,000-30,000 ft, usually direct. Cruise missile — 400-550 kts, under 1,000 ft, terrain-following…",
  },
  {
    id: "identification",
    question: "What identification states exist, and what puts a track into each one?",
    hint: "Every state the operator sees, and what has to happen for a track to reach it.",
    placeholder:
      "e.g. Unknown — no response and no correlation. Assumed hostile — inside the engagement zone with no IFF response…",
  },
  {
    id: "readouts",
    question: "What does the operator read for each track?",
    hint: "The exact columns on the display, in the order they appear, with their units.",
    placeholder:
      "e.g. Track number, bearing in degrees, range in km, altitude in feet, speed in knots, time to impact in seconds…",
  },
  {
    id: "operator_actions",
    question: "What can the operator actually do, and in what order?",
    hint: "The real sequence of actions, not a summary of the goal.",
    placeholder:
      "e.g. Select a track, request identification, assign a launcher, arm, commit, then monitor for a kill assessment…",
  },
  {
    id: "automatic",
    question: "What does the system do on its own, without the operator?",
    hint: "Anything the operator does not have to decide. It changes what the training is about.",
    placeholder:
      "e.g. Correlates radar returns into tracks, calculates time to impact, warns when a track enters the engagement envelope…",
  },
  {
    id: "engagement",
    question: "What are the engagement constraints?",
    hint: "Minimum and maximum range, time of flight, and how many engagements can run at once.",
    placeholder:
      "e.g. 5 to 40 km, roughly 25 seconds of flight at mid-range, three simultaneous engagements…",
  },
  {
    id: "authority",
    question: "Who may authorise an engagement, and when does that change?",
    hint: "Normal authority, and what shifts it — declared states, self-defence, loss of communications.",
    placeholder:
      "e.g. Battery commander normally; the operator may engage autonomously under a declared air-defence emergency…",
  },
];

const EXTRACTION_SYSTEM = `You convert a designer's description of an air-defence system into a structured behaviour profile, for a training simulator.

Everything downstream reads this record. Scenario generation uses it to decide what tracks may exist and what numbers are plausible; the console uses it to decide what columns to show and what colours to use; the debrief uses it to know what an operator could have done. Getting it wrong is invisible until a trainee is being taught something untrue.

## Rules

**Ground everything in the designer's answers.** Every field must trace to something they wrote. Where an answer is thin, generalise conservatively from what is there — do not import doctrine from elsewhere and do not invent a capability that was not described.

**Where they were silent**, fill the field with the most defensible reading of the surrounding answers and keep it modest. Never leave a field empty or write a placeholder: the designer reviews and corrects this record before approving it, and a plausible starting point is easier to correct than a blank.

**track_readout_fields is the console's column list.** Take the labels from what the designer said their display shows, in their order, in their wording — abbreviated the way a console abbreviates ("RNG", not "Range to target"). If they gave units, carry them.

## Screenshots, when there are any

You may be shown screenshots of the real console. They are **evidence about the display, never authority about the system.**

**A screenshot is one moment.** What is on screen is a sample, not an inventory. Never conclude that the only identification states are the ones visible, that the only track classes are the ones flying, or that a capability is absent because nothing is currently using it. Nothing may be *removed* from the profile because a screenshot did not happen to show it.

**Where they are worth trusting: what is written on the display.** Column labels, their order, their units, and the colours attached to identification states. Here a screenshot is better evidence than a sentence, because the designer is describing from memory something they are looking at every day. Prefer the wording and order you can actually read.

**A visible control is not proof of who decides.** A button on screen says the system can do a thing; it does not say the operator is the one who chooses it, or when. Operator responsibilities and automatic functions come from the answers alone.

**Where a screenshot contradicts an answer, follow the answer** and record the disagreement in general_notes, naming both readings. The designer knows things a screenshot cannot show, and they review this record before approving it — a flagged conflict gets resolved, a silently chosen one does not.

**Never carry identifying content across.** Vendor names, unit markings, real call signs, place names and serial numbers appear in screenshots and must not reach the profile.

**iff_states.tone maps each state onto the console's status palette.** Use \`friendly\` for confirmed friendly, \`hostile\` for confirmed hostile, \`caution\` for anything leaning hostile but unresolved, and \`neutral\` for genuinely unknown or unclassified. This is what makes the display readable at a glance, so it has to match how an operator actually reads urgency.

**Separate what the operator decides from what the system does.** If the system correlates tracks automatically, that is not an operator responsibility, and a scenario must not ask a trainee to do it.

**Speed and altitude bands must be plausible for the class described** and consistent with the engagement ranges given. If the designer's numbers conflict, follow their numbers and note the conflict in general_notes rather than silently correcting them.

**general_notes carries what the questions did not ask about** — anything the designer added in the open section that does not belong in a named field, and anything you had to assume.

**The system already has a name and it is not yours to change.** You are told what it is; use it if you need to refer to the system, and never invent another.

Keep everything vendor-neutral: generic descriptions, no real system names, unit designations or classified performance figures.`;

const MOCK_PROFILE: SystemProfileDraft = {
  purpose:
    "Placeholder profile produced in mock mode. Point defence of a fixed installation against air-breathing threats.",
  track_classifications: [
    {
      name: "fast air",
      description: "Manned aircraft on a direct approach.",
      typical_speed_kts: { min: 400, max: 600 },
      typical_altitude_ft: { min: 5000, max: 30000 },
      behaviour_note: "Usually direct, may manoeuvre when illuminated.",
    },
    {
      name: "cruise missile",
      description: "Low, fast, terrain-following.",
      typical_speed_kts: { min: 400, max: 550 },
      typical_altitude_ft: { min: 200, max: 1000 },
      behaviour_note: "Holds a steady profile and does not react to illumination.",
    },
  ],
  iff_states: [
    {
      name: "unknown",
      meaning: "No identification established.",
      how_determined: "No IFF response and no correlation to a filed track.",
      tone: "neutral",
    },
    {
      name: "assumed hostile",
      meaning: "Treated as a threat pending confirmation.",
      how_determined: "Inside the engagement zone with no IFF response.",
      tone: "caution",
    },
    {
      name: "confirmed hostile",
      meaning: "Positively identified as a threat.",
      how_determined: "Declared hostile by the controlling authority.",
      tone: "hostile",
    },
  ],
  track_readout_fields: [
    { label: "BRG", unit: "°", description: "Bearing from the site." },
    { label: "RNG", unit: "km", description: "Slant range." },
    { label: "ALT", unit: "ft", description: "Altitude." },
    { label: "SPD", unit: "kts", description: "Ground speed." },
    { label: "TTI", unit: "s", description: "Time to impact." },
  ],
  engagement: {
    min_range_km: 5,
    max_range_km: 40,
    time_of_flight_note: "Roughly 25 seconds to mid-range.",
    simultaneous_engagements_note: "Three engagements can run at once.",
    authority_note: "Mock authority note. Configure an API key for the real one.",
  },
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
    "Mock profile. No ANTHROPIC_API_KEY is configured, so this is a built-in placeholder rather than a reading of your answers.",
};

export async function extractSystemProfile(
  systemName: string,
  answers: Array<{ question: string; answer: string }>,
  openNotes: string,
  /** The system's stored references, when it has any. Evidence, not authority. */
  screenshots: Array<{ mediaType: string; base64: string }> = [],
): Promise<SystemProfileDraft> {
  const transcript = answers
    .filter((entry) => entry.answer.trim().length > 0)
    .map((entry) => `Q: ${entry.question}\nA: ${entry.answer}`)
    .join("\n\n");

  const prose = [
    `The system is called "${systemName}".`,
    `<answers>\n${transcript}\n</answers>`,
    openNotes.trim()
      ? `<additional_notes>\n${openNotes}\n</additional_notes>`
      : "<additional_notes>none</additional_notes>",
    screenshots.length > 0
      ? `The ${screenshots.length} image${screenshots.length === 1 ? "" : "s"} above ${screenshots.length === 1 ? "is a screenshot" : "are screenshots"} of this system's real console. Read them as evidence of what the display shows — they are not a description of how the system behaves, and the designer's answers outrank them.`
      : "No screenshots of the console were provided.",
    "Produce the system behaviour profile.",
  ].join("\n\n");

  return structured({
    system: EXTRACTION_SYSTEM,
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
    schema: SystemProfileDraftSchema,
    // Medium rather than high. This is a reading task: the designer has already
    // written the answers and the labels are printed on the screenshots, so the
    // work is transcription and tidying rather than reasoning. High effort spent
    // its extra thinking time without changing the record, and the platform cuts
    // the request off at sixty seconds — a profile that never arrives is worth
    // less than one that arrives slightly plainer.
    effort: "medium",
    maxTokens: 16000,
    mock: () => MOCK_PROFILE,
  });
}
