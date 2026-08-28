import "server-only";
import {
  ScenarioInstanceSchema,
  type DifficultyLevel,
  type DilemmaEntry,
  type ScenarioInstance,
} from "../../domain/schemas";
import { structured } from "../client";

/**
 * Screen 3, step 2 — turning an abstract dilemma into one concrete run.
 *
 * The dilemma says "between 3 and 6 threats, one of them ambiguous". This call
 * decides that today there are four, that TK-2214 is the ambiguous one, that it
 * is 62 km out on a bearing of 047, and that it will be overhead in 94 seconds.
 */

const SCENARIO_SYSTEM = `You instantiate one concrete air-defence training scenario from a stored dilemma definition.

You are given the dilemma record and a difficulty level. Produce a specific, playable situation.

## Hard constraints

**Stay inside the dilemma's own numbers.** Threat count and time window must fall within the difficulty band for the requested level, and resource quantities within key_variables.resource_levels. Every track's iff_status must be one of the dilemma's declared iff_certainty_levels — verbatim.

**Mirror the decision points exactly.** Produce one scenario decision point per decision point in the dilemma, in the same order, with kb_decision_point_index set to that entry's zero-based position. The action labels must be the dilemma's valid_actions labels, character for character — the debrief matches on those strings, and a reworded label silently breaks scoring.

You may reorder the actions within a decision point, and you should: a preferred action that is always first is a giveaway.

## Making it real

The tracks must make the dilemma *bite*. If the dilemma is about ambiguous identification under time pressure, then the geometry has to force the trade — the ambiguous track closer than the confirmed one, or the confirmed threat reachable only if the operator commits now. Numbers that do not create the tension produce a scenario that looks right and trains nothing.

Keep the physics coherent: range, speed and time-to-impact must agree with each other, headings must be consistent with bearings, and altitudes must suit the stated classification.

**situation_rendered** restates that decision point's situation in the concrete terms of this scenario — real designators, real ranges, real seconds remaining — without giving away which action is preferred.

**situation_brief** is what the trainee reads before the clock starts: their posture, what is inbound, what they hold. Neutral in tone. It sets the problem; it does not hint at the answer.

Keep it vendor-neutral: generic system descriptions, invented track designators, no real unit or platform names.`;

const DIFFICULTY_GUIDANCE: Record<DifficultyLevel, string> = {
  easy: "Keep the geometry legible and give the trainee room to think. The dilemma should still be a dilemma, but not a scramble.",
  medium: "Standard operational pressure. The trade-off should be clear but uncomfortable.",
  hard: "Compress everything. The trainee should finish the run aware that something had to be given up.",
};

export async function generateScenario(
  dilemma: DilemmaEntry,
  difficulty: DifficultyLevel,
): Promise<ScenarioInstance> {
  const band = dilemma.difficulty_scaling[difficulty];

  return structured({
    system: SCENARIO_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `<dilemma>\n${JSON.stringify(dilemma, null, 2)}\n</dilemma>`,
          `<difficulty level="${difficulty}">\n${JSON.stringify(band, null, 2)}\n</difficulty>`,
          `<guidance>${DIFFICULTY_GUIDANCE[difficulty]}</guidance>`,
          "Produce the scenario instance.",
        ].join("\n\n"),
      },
    ],
    schema: ScenarioInstanceSchema,
    effort: "high",
    maxTokens: 16000,
    mock: () => mockScenario(dilemma, difficulty),
  });
}

function mockScenario(
  dilemma: DilemmaEntry,
  difficulty: DifficultyLevel,
): ScenarioInstance {
  const band = dilemma.difficulty_scaling[difficulty];
  const count = Math.max(2, band.threat_count.min);

  return {
    scenario_name: `Mock run — ${dilemma.title} (${difficulty})`,
    situation_brief:
      "Mock scenario. No ANTHROPIC_API_KEY is configured, so these tracks are generated locally rather than by the model. The decision points below are taken straight from the knowledge base entry.",
    time_window_seconds: band.time_window_seconds.min,
    tracks: Array.from({ length: count }, (_, index) => ({
      designator: `TK-${1000 + index * 137}`,
      iff_status:
        dilemma.key_variables.iff_certainty_levels[
          index % dilemma.key_variables.iff_certainty_levels.length
        ] ?? "unknown",
      classification: index % 2 === 0 ? "fast air" : "cruise missile",
      bearing_deg: 30 + index * 25,
      range_km: 90 - index * 12,
      altitude_ft: 12000 - index * 1500,
      speed_kts: 420 + index * 60,
      heading_deg: (210 + index * 25) % 360,
      time_to_impact_seconds: band.time_window_seconds.min - index * 8,
      notes: index === 1 ? "Identification unresolved." : "Track stable.",
    })),
    resources: dilemma.key_variables.resource_levels.map((resource) => ({
      name: resource.name,
      unit: resource.unit,
      available: resource.min,
      total: resource.max,
    })),
    decision_points: dilemma.decision_points.map((point, index) => ({
      kb_decision_point_index: index,
      situation_rendered: point.situation,
      actions: point.valid_actions,
    })),
  };
}
