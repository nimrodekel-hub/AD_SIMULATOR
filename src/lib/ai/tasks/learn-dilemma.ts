import "server-only";
import {
  DilemmaDraftSchema,
  type DilemmaDraft,
} from "../../domain/schemas";
import { streamChat, structured, type Anthropic } from "../client";

/**
 * Screen 1a — teaching the system a dilemma.
 *
 * Two distinct AI calls, deliberately not merged:
 *
 *   1. `designerChatStream` runs the interview. It is conversational, streams,
 *      and never emits JSON.
 *   2. `extractDilemma` reads the finished transcript and produces the
 *      structured record.
 *
 * Merging them would force the interviewer to hold a JSON schema in mind while
 * talking, which makes it a worse interviewer — and it would mean re-deriving
 * the whole record on every turn instead of once, when the expert says they are
 * done.
 */

/* ------------------------------------------------------------------ */
/* 1. The interview                                                    */
/* ------------------------------------------------------------------ */

const INTERVIEW_SYSTEM = `You are a knowledge engineer interviewing a subject-matter expert in order to capture one operational dilemma in air defence, so that a training simulator can later generate exercises from it.

## Scope

Exactly one problem domain: **prioritising engagement decisions under multiple simultaneous air threats**. Everything you capture must serve that. If the expert drifts to logistics, maintenance, procurement or unrelated domains, note it politely and steer back.

Stay at the level of generic doctrine and tradecraft. This is a vendor-neutral training tool: do not ask about, and do not record, the identity, performance figures, or classified specifics of any real weapon system, unit, or engagement. When an expert offers such a detail, generalise it — "a medium-range interceptor with a 30-second minimum engagement window", not a named system. If the expert seems to be heading toward material they should not share, say so plainly and move on.

## Your goal

By the end of the conversation you must have enough to fill in every one of these:

- **title** — a short name for the dilemma.
- **sub_domain_tag** — a kebab-case tag, e.g. multi-threat-prioritization.
- **trigger_conditions** — when this dilemma is the right one to train. Written so that another AI, reading a trainee's free-text request, can decide whether this entry matches it. This field is what makes the dilemma findable, so it deserves real attention: what words would a trainee use to ask for it?
- **key_variables** — the dials that make each run different: how many threats, how much time, what IFF certainty levels exist (ordered from least to most certain), and what resources are constrained (name, unit, plausible min/max).
- **decision_points** — the branch points. For each: the situation, the actions genuinely available, which action is preferred, **why** it is preferred, and the mistakes trainees actually make there.
- **difficulty_scaling** — how the same dilemma gets harder: threat count, time window, and how ambiguity and resource pressure shift across easy / medium / hard.
- **evaluation_criteria** — what counts as success, objectively enough to score against, and what separates a mediocre run from a good one.

## How to interview

Ask about **one or two things at a time**. Do not deliver a questionnaire — this is a conversation, and an expert who is asked eight questions at once will answer three of them.

Prefer specifics over abstractions. "What would make an operator hesitate here?" gets you a real dilemma; "describe the decision process" gets you a flowchart. Push for the *rationale* behind the preferred action, and for the errors the expert has actually seen — those two fields are what the debrief is later built from, and a vague answer there produces a worthless debrief.

Reflect back what you have understood in your own words, so the expert can correct you early.

Keep replies short. Two or three sentences plus your question, normally.

When you judge that you have enough to fill in every field above, say so explicitly and tell the expert they can press **"Extract structured entry"** to review the record. If some fields are still thin, say which ones, and let the expert decide whether to keep going or extract anyway.

Never output JSON. That is a separate step handled by a different call.`;

const MOCK_REPLY = `[Mock mode — no ANTHROPIC_API_KEY is configured, so this is a canned reply.]

Understood. Before we go further: when several tracks are inbound at once and at least one has ambiguous IFF, what is the thing that most often makes an operator hesitate — the ambiguity itself, or the interceptor count?`;

export function designerChatStream(
  messages: Anthropic.MessageParam[],
): ReadableStream<Uint8Array> {
  return streamChat({
    system: INTERVIEW_SYSTEM,
    messages,
    // Medium rather than high, and this is the single biggest lever on what
    // the app costs to run. Thinking is billed as output and is the larger
    // half of a conversational call, and this call happens on *every turn* of
    // an interview — so maximum reasoning was being bought a dozen times over
    // to produce three sentences and a question.
    //
    // Interviewing is not where the reasoning has to be deep: the prompt above
    // asks for one or two questions at a time, kept short. The judgement calls
    // that decide whether the captured knowledge is any good happen later, in
    // the extraction, the scenario and the debrief — and those stay high.
    effort: "medium",
    label: "interview",
    mock: MOCK_REPLY,
  });
}

/* ------------------------------------------------------------------ */
/* 2. The extraction                                                   */
/* ------------------------------------------------------------------ */

const EXTRACTION_SYSTEM = `You convert a completed knowledge-capture interview into one structured dilemma record for an air-defence training simulator.

## Rules

**Ground everything in the transcript.** Every field must be traceable to something the expert said. Where the transcript is thin, generalise conservatively from what is there — never import outside doctrine or invent a decision point that was not discussed.

**Where the expert was genuinely silent**, fill the field with the most defensible reading of the surrounding conversation and keep it modest in scope. Do not leave a field empty or write placeholder text: the designer reviews and edits this record before it is published, and a plausible starting point is easier to correct than a blank.

**trigger_conditions** is the matching surface. Write it as a description of the situations and phrasings that should route a trainee here — include the vocabulary a trainee would plausibly use, not just the formal name of the dilemma.

**preferred_action must exactly match one of that decision point's valid_actions labels.** Not a paraphrase — the same string.

**rationale and common_errors are the debrief's raw material.** Write them as complete explanations that stand on their own, because the debriefing call will quote them back to a trainee who has no access to this transcript.

**valid_actions must include genuinely defensible wrong answers**, not obvious throwaways. A decision point whose alternatives are transparently bad teaches nothing.

**difficulty_scaling** must stay inside the ranges given in key_variables, and must actually escalate: hard means more threats, less time, more ambiguity, or tighter resources than medium.

Keep everything vendor-neutral and generic. No real system names, unit designations, or classified performance figures.`;

const MOCK_DRAFT: DilemmaDraft = {
  title: "Mock dilemma — configure ANTHROPIC_API_KEY for real extraction",
  sub_domain_tag: "multi-threat-prioritization",
  trigger_conditions:
    "Placeholder record produced in mock mode. Matches requests about prioritising between simultaneous threats when interceptors are limited.",
  key_variables: {
    threat_count_range: { min: 2, max: 6 },
    time_window_seconds: { min: 45, max: 180 },
    iff_certainty_levels: ["unknown", "assumed hostile", "confirmed hostile"],
    resource_levels: [
      { name: "interceptors", unit: "rounds", min: 2, max: 8 },
      { name: "engagement channels", unit: "channels", min: 1, max: 3 },
    ],
  },
  decision_points: [
    {
      situation:
        "Two tracks close simultaneously. One is confirmed hostile and further out; one is unidentified and closer.",
      valid_actions: [
        { label: "Engage the confirmed hostile", description: "Commit to the identified threat first." },
        { label: "Engage the closer unknown", description: "Treat time-to-impact as the dominant factor." },
        { label: "Hold and request identification", description: "Spend time to resolve the ambiguity." },
      ],
      preferred_action: "Engage the confirmed hostile",
      rationale:
        "Mock rationale. With a real API key this field carries the expert's own reasoning, quoted back in the debrief.",
      common_errors: [
        "Anchoring on proximity alone and ignoring identification confidence.",
      ],
    },
  ],
  difficulty_scaling: {
    easy: {
      description: "Two tracks, generous time, clear identification.",
      threat_count: { min: 2, max: 2 },
      time_window_seconds: { min: 150, max: 180 },
      pressure_note: "Identification is resolved before the decision point.",
    },
    medium: {
      description: "Three or four tracks, one ambiguous.",
      threat_count: { min: 3, max: 4 },
      time_window_seconds: { min: 90, max: 130 },
      pressure_note: "One track stays unidentified through the decision.",
    },
    hard: {
      description: "Five or six tracks, interceptors short of threat count.",
      threat_count: { min: 5, max: 6 },
      time_window_seconds: { min: 45, max: 75 },
      pressure_note: "Resources force an explicit sacrifice; two tracks stay ambiguous.",
    },
  },
  evaluation_criteria: {
    success_condition:
      "Mock success condition. All confirmed hostiles engaged within the time window without expending the reserve.",
    scoring_notes:
      "Mock scoring notes. Full credit for the preferred action at every decision point.",
  },
};

/**
 * Reads the interview transcript and produces the structured record the
 * designer will review, edit and approve.
 */
export async function extractDilemma(
  transcript: string,
): Promise<DilemmaDraft> {
  return structured({
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Here is the completed interview transcript. Produce the structured dilemma record.\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
    schema: DilemmaDraftSchema,
    effort: "high",
    maxTokens: 16000,
    label: "extract-dilemma",
    mock: () => MOCK_DRAFT,
  });
}
