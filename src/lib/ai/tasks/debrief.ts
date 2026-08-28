import "server-only";
import {
  DebriefSchema,
  type Debrief,
  type DecisionMade,
  type DilemmaEntry,
  type ScenarioInstance,
} from "../../domain/schemas";
import { structured } from "../client";

/**
 * Screen 4 — scoring the run and explaining it back.
 *
 * The one rule that matters here: the explanation comes from the knowledge
 * base, not from the model's own opinion about air defence. The expert's
 * rationale and their list of common errors are what the trainee reads. A model
 * that argues a well-reasoned but unsanctioned position would quietly teach
 * something the expert never approved.
 */

const DEBRIEF_SYSTEM = `You debrief a trainee after one run of an air-defence training scenario.

You are given the dilemma record from the knowledge base (including, for each decision point, the preferred action, the expert's rationale, and the errors trainees commonly make), the scenario as it was presented, and the actions the trainee actually took.

## The binding rule

**Every judgement you make must come from the knowledge base.** The expert's rationale is the authority on why an action was right or wrong — not your own reasoning about air defence. If you find yourself explaining something the record does not contain, stop and use what the record says instead.

Where the trainee's choice matches a documented common error, name that error and explain why it is tempting. That connection is the single most useful thing in a debrief.

If the trainee did something the record simply does not address, say so plainly rather than inventing a verdict for it.

## Scoring

Score 0-100, following the entry's scoring_notes. In the absence of more specific guidance: the proportion of decision points answered with the preferred action, adjusted for how consequential each one was. Set outcome.success from the entry's success_condition, evaluated against what the trainee actually did — a passable score with the success condition unmet is a failed run, and should read as one.

Fill per_decision for every decision point in the scenario, in order, whether or not the trainee reached it. An unanswered decision point is a miss.

## Tone

Write to a professional adult in training. Direct about what went wrong, specific about why, no padding and no false encouragement. Lead with what actually decided the outcome rather than working through the decisions in order — if one choice determined the run, say that first.

Address the trainee as "you". Two to four short paragraphs.

## Recommendations

Two to four concrete things to work on next, each tied to something that happened in this run. "Practise faster identification calls when two tracks converge" — not "continue to develop situational awareness".`;

export async function generateDebrief(input: {
  dilemma: DilemmaEntry;
  scenario: ScenarioInstance;
  decisions: DecisionMade[];
}): Promise<Debrief> {
  const { dilemma, scenario, decisions } = input;

  // Pair each decision point with what the trainee chose there, so the model
  // never has to correlate two lists by index and cannot mis-align them.
  const playback = scenario.decision_points.map((point, index) => {
    const kbPoint = dilemma.decision_points[point.kb_decision_point_index];
    const decision = decisions.find((d) => d.decision_point_index === index);
    return {
      decision_point_index: index,
      situation: point.situation_rendered,
      trainee_chose: decision?.chosen_action ?? "(no answer given)",
      seconds_taken: decision ? Math.round(decision.elapsed_ms / 1000) : null,
      preferred_action: kbPoint?.preferred_action ?? "(not in knowledge base)",
      expert_rationale: kbPoint?.rationale ?? "",
      known_common_errors: kbPoint?.common_errors ?? [],
    };
  });

  return structured({
    system: DEBRIEF_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `<evaluation_criteria>\n${JSON.stringify(dilemma.evaluation_criteria, null, 2)}\n</evaluation_criteria>`,
          `<scenario_brief>\n${scenario.situation_brief}\n</scenario_brief>`,
          `<run>\n${JSON.stringify(playback, null, 2)}\n</run>`,
          "Produce the debrief.",
        ].join("\n\n"),
      },
    ],
    schema: DebriefSchema,
    effort: "high",
    maxTokens: 8000,
    mock: () => mockDebrief(playback),
  });
}

type Playback = Array<{
  decision_point_index: number;
  trainee_chose: string;
  preferred_action: string;
  expert_rationale: string;
}>;

function mockDebrief(playback: Playback): Debrief {
  const perDecision = playback.map((entry) => ({
    decision_point_index: entry.decision_point_index,
    chosen_action: entry.trainee_chose,
    preferred_action: entry.preferred_action,
    correct: entry.trainee_chose === entry.preferred_action,
    comment: entry.expert_rationale || "No rationale recorded for this decision point.",
  }));
  const correct = perDecision.filter((entry) => entry.correct).length;
  const score = perDecision.length
    ? Math.round((correct / perDecision.length) * 100)
    : 0;

  return {
    score,
    outcome: {
      success: score >= 70,
      summary: `Mock evaluation — ${correct} of ${perDecision.length} decision points matched the preferred action.`,
      per_decision: perDecision,
    },
    debrief_text:
      "Mock debrief. No ANTHROPIC_API_KEY is configured, so this is scored by exact-match against the knowledge base rather than by the model. The per-decision comments below are the expert's own rationale, quoted directly.",
    recommendations: ["Configure ANTHROPIC_API_KEY to get a real debrief."],
  };
}
