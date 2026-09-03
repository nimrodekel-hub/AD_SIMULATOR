import "server-only";
import {
  DebriefSchema,
  type Debrief,
  type ScenarioEntry,
  type RunResult,
  type ExerciseInstance,
  type SimEvent,
} from "../../domain/schemas";
import { structured } from "../client";

/**
 * Screen 4 — scoring the run and explaining it back.
 *
 * Two rules matter here, and they pull in different directions.
 *
 * The explanation comes from the knowledge base, not from the model's own
 * opinion about air defence: the expert's rationale and their list of common
 * errors are what the trainee reads. A model that argues a well-reasoned but
 * unsanctioned position would quietly teach something the expert never
 * approved.
 *
 * The *facts*, though, come from neither. What happened was counted by the
 * simulation from the run log — how many leaked, what was spent, whether a
 * friendly was engaged — and the model is told plainly not to relitigate any
 * of it. Judgement is the model's; arithmetic is not.
 */

const DEBRIEF_SYSTEM = `You debrief an air-defence operator after one live engagement.

They did not answer questions. They sat at the console while tracks closed in real time, identified what they could, chose rounds and fired — or did not. You are given the scenario record from the knowledge base (the expert's reasoning and the errors trainees commonly make), what the run was scored on, the second-by-second log of what happened, and the tally the simulation counted.

## The binding rule

**Every judgement you make must come from the knowledge base.** The expert's rationale is the authority on what good practice is here — not your own reasoning about air defence. Where the log shows something the record does not address, say so plainly rather than inventing a verdict.

Where what they did matches a documented common error, name that error and explain why it was tempting *at that moment in this run*. That connection is the single most useful thing in a debrief.

## The numbers are already decided

The tally — leakers, kills, fratricide, rounds spent, reaction time — was counted by the simulation. **Never contradict it, recompute it, or soften it.** Your job is to explain how those numbers came about and what to do differently.

## What actually matters, in order

1. **Anything friendly engaged.** This fails the run outright, whatever else went well, and the debrief opens with it.
2. **Anything hostile that reached the defended area**, and what the log shows they were doing instead.
3. **Rounds wasted** — shots refused, shots broken off, shots taken at poor geometry when waiting would have been better. The log carries the Pk of every launch; a 40% shot taken when a 90% one was seconds away is worth naming.
4. **Reaction time**, but only where it changed the outcome. Being slow on a track that was still destroyed comfortably is not the lesson.

Refusals in the log are not system faults. "Inside minimum range" means they let a threat get too close before committing; "already in the air" means they had spent their capacity. Read them as evidence about the operator.

**Where the log carries \`interrogated\` entries, read them as identification work.** A track engaged without ever being interrogated, on a system that could have interrogated it, is worth naming — and so is the opposite: a transponder reply that was read and then ignored. A reply of "no reply" is not proof of hostility and never was; treating it as proof is one of the more expensive habits an operator can form. If the log shows no interrogation at all, do not invent one — the system may not have an interrogator.

## Scoring

Score 0-100 following the entry's scoring_notes. In their absence: start from whether the success criteria were met, then weigh efficiency and timeliness. **Engaging a friendly caps the score at 20 regardless of everything else.** Set outcome.success from whether the criteria were met.

Use per_decision to walk through the *turning points* of the run — the launch that decided it, the identification that was left too late, the leaker. One entry per moment worth discussing, not one per track. Put the time in the comment. \`chosen_action\` is what they did; \`preferred_action\` is what the record says good practice was.

## Tone

Write to a professional adult in training. Direct about what went wrong, specific about why, no padding and no false encouragement. Lead with whatever actually decided the run.

Address the trainee as "you". Two to four short paragraphs.

## Recommendations

Two to four concrete things to work on next, each tied to something that happened in this run. "Commit to the closing track before it reaches 20 km, rather than waiting for the system to resolve it" — not "continue to develop situational awareness".`;

export async function generateDebrief(input: {
  scenario: ScenarioEntry;
  exercise: ExerciseInstance;
  log: SimEvent[];
  result: RunResult;
}): Promise<Debrief> {
  const { scenario, exercise, log, result } = input;

  /* What the expert said about this scenario, flattened once so the model is
     not asked to correlate two lists by index — the old shape paired each
     dilemma with an answer, and there are no answers any more. */
  const doctrine = scenario.dilemmas.map((point, index) => ({
    situation: point.situation,
    preferred_action: point.preferred_action,
    expert_rationale: point.rationale,
    known_common_errors: point.common_errors,
    index,
  }));

  return structured({
    system: DEBRIEF_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `<evaluation_criteria>\n${JSON.stringify(scenario.evaluation_criteria, null, 2)}\n</evaluation_criteria>`,
          `<expert_doctrine>\n${JSON.stringify(doctrine, null, 2)}\n</expert_doctrine>`,
          `<success_criteria>\n${JSON.stringify(exercise.success_criteria, null, 2)}\n</success_criteria>`,
          `<what_was_flown>\n${exercise.situation_brief}\n\nTracks: ${JSON.stringify(
            exercise.live_tracks.map((track) => ({
              designator: track.designator,
              classification: track.classification,
              it_really_was: track.truth_iff,
              shown_at_first_as: track.initial_iff,
              appeared_at_s: track.appears_at_s,
            })),
            null,
            2,
          )}\n</what_was_flown>`,
          `<run_log>\n${log.map((entry) => `T+${String(Math.floor(entry.t)).padStart(3, "0")} [${entry.kind}] ${entry.detail}`).join("\n")}\n</run_log>`,
          `<counted_result>\n${JSON.stringify(result, null, 2)}\n</counted_result>`,
          "Produce the debrief.",
        ].join("\n\n"),
      },
    ],
    schema: DebriefSchema,
    effort: "high",
    maxTokens: 8000,
    label: "debrief",
    mock: () => mockDebrief(result, log),
  });
}

/**
 * A stand-in built from the tally rather than from the model.
 *
 * Worth keeping honest: with no API key the score still reflects what actually
 * happened in the run, so the whole loop can be exercised and the number on
 * the screen is never a lie about the flying.
 */
function mockDebrief(result: RunResult, log: SimEvent[]): Debrief {
  const score = result.friendly_engaged > 0
    ? 15
    : result.met_criteria
      ? Math.max(60, 100 - result.interceptors_spent * 5)
      : Math.max(20, 60 - result.leakers * 20);

  const turningPoints = log
    .filter((entry) => ["hit", "leaked", "miss", "refused"].includes(entry.kind))
    .slice(0, 6)
    .map((entry, index) => ({
      dilemma_index: index,
      chosen_action: entry.detail,
      preferred_action: "(mock mode — no assessment made)",
      correct: entry.kind === "hit",
      comment: `T+${Math.floor(entry.t)}s.`,
    }));

  return {
    score,
    outcome: {
      success: result.met_criteria,
      summary: `Mock assessment. ${result.hostiles_destroyed} hostile(s) destroyed, ${result.leakers} leaked, ${result.interceptors_spent} round(s) spent, ${result.friendly_engaged} friendly engaged.`,
      per_decision: turningPoints,
    },
    debrief_text:
      "Mock debrief. No ANTHROPIC_API_KEY is configured, so this text is a placeholder — but the tally above is real: it was counted from the run you just flew.",
    recommendations: [
      "Configure an API key to get a real assessment of this run.",
    ],
  };
}
