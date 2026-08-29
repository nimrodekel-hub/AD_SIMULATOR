import "server-only";
import {
  ScenarioInstanceSchema,
  type DifficultyLevel,
  type DilemmaEntry,
  type ScenarioInstance,
  type SystemProfile,
} from "../../domain/schemas";
import { structured } from "../client";

/**
 * Screen 3, step 2 — turning an abstract dilemma into one concrete run.
 *
 * The dilemma says "between 3 and 6 threats, one of them ambiguous". This call
 * decides that today there are four, that TK-2214 is the ambiguous one, that it
 * is 62 km out on a bearing of 047, and that it will be overhead in 94 seconds.
 *
 * The system profile is what stops those numbers from being invented. It
 * declares which classifications exist, what identification states are
 * possible, which readouts the console shows and what the weapon can reach —
 * so the scenario is constrained by the designer's system rather than by the
 * model's idea of an air-defence system.
 */

const SCENARIO_SYSTEM = `You instantiate one concrete air-defence training scenario from a stored dilemma definition.

You are given the dilemma record, a difficulty level, and — when the designer has taught one — a profile of how the simulated system actually behaves. Produce a specific, playable situation.

## The system profile governs everything it covers

When a profile is supplied it is not advice, it is the specification:

- **Every track's classification must be one of the profile's declared classifications, by name.** Never invent a class.
- **Every track's iff_status must be one of the profile's declared identification states, by name.** Never invent a state, and never use a state in a way its \`how_determined\` rules out.
- **Speed and altitude must sit inside the band the profile gives for that classification.**
- **A track on the display must be inside what \`sensor\` can see.** Nothing appears further out than the detection range, closer than a stated blind zone, or above or below the altitude band. Where an azimuth coverage of less than 360° is given, the system watches an arc and is blind behind it — a threat coming through the gap is seen late or not at all, and that is a scenario worth building deliberately, never one to write by accident.
- **Ranges must sit inside the engagement envelope**, and the geometry must respect the stated time of flight. A threat that cannot be reached in time is only a valid scenario element if the dilemma is *about* that.
- **readouts must contain exactly one entry per \`track_readout_fields\`, in the same order, using the same labels.** The value is the number with its unit, as the console would show it — "62 km", "047°", "94 s". Nothing else goes in that array.
- **A decision point may only ask the trainee to do things the profile lists as operator responsibilities.** Never ask them to do something the profile says the system does automatically.

If no profile is supplied, use generic and clearly plausible air-defence conventions, and keep the readouts to bearing, range, altitude, speed and time to impact.

## Hard constraints from the dilemma

**Stay inside the dilemma's own numbers.** Threat count and time window must fall within the difficulty band for the requested level, and resource quantities within key_variables.resource_levels.

**Mirror the decision points exactly.** Produce one scenario decision point per decision point in the dilemma, in the same order, with kb_decision_point_index set to that entry's zero-based position. The action labels must be the dilemma's valid_actions labels, character for character — the debrief matches on those strings, and a reworded label silently breaks scoring.

You may reorder the actions within a decision point, and you should: a preferred action that is always first is a giveaway.

## Making it real

The tracks must make the dilemma *bite*. If the dilemma is about ambiguous identification under time pressure, then the geometry has to force the trade — the ambiguous track closer than the confirmed one, or the confirmed threat reachable only if the operator commits now. Numbers that do not create the tension produce a scenario that looks right and trains nothing.

Keep the physics coherent: range, speed and time-to-impact must agree with each other, and altitudes must suit the stated classification.

**situation_rendered** restates that decision point's situation in the concrete terms of this scenario — real designators, real ranges, real seconds remaining — without giving away which action is preferred.

**situation_brief** is what the trainee reads before the clock starts: their posture, what is inbound, what they hold. Neutral in tone. It sets the problem; it does not hint at the answer.

Keep it vendor-neutral: invented track designators, no real unit or platform names.`;

const DIFFICULTY_GUIDANCE: Record<DifficultyLevel, string> = {
  easy: "Keep the geometry legible and give the trainee room to think. The dilemma should still be a dilemma, but not a scramble.",
  medium: "Standard operational pressure. The trade-off should be clear but uncomfortable.",
  hard: "Compress everything. The trainee should finish the run aware that something had to be given up.",
};

export async function generateScenario(
  dilemma: DilemmaEntry,
  difficulty: DifficultyLevel,
  profile: SystemProfile | null,
): Promise<ScenarioInstance> {
  const band = dilemma.difficulty_scaling[difficulty];

  return structured({
    system: SCENARIO_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          profile
            ? `<system_profile>\n${JSON.stringify(stripProvenance(profile), null, 2)}\n</system_profile>`
            : "<system_profile>none taught — use generic conventions</system_profile>",
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
    label: "scenario",
    mock: () => mockScenario(dilemma, difficulty, profile),
  });
}

/** The raw answers and timestamps are provenance, not behaviour. */
function stripProvenance(profile: SystemProfile) {
  const { id, approved, source_answers, created_at, approved_at, ...behaviour } =
    profile;
  void id;
  void approved;
  void source_answers;
  void created_at;
  void approved_at;
  return behaviour;
}

function mockScenario(
  dilemma: DilemmaEntry,
  difficulty: DifficultyLevel,
  profile: SystemProfile | null,
): ScenarioInstance {
  const band = dilemma.difficulty_scaling[difficulty];
  const count = Math.max(2, band.threat_count.min);

  const fields = profile?.track_readout_fields ?? [
    { label: "BRG", unit: "°", description: "" },
    { label: "RNG", unit: "km", description: "" },
    { label: "ALT", unit: "ft", description: "" },
    { label: "SPD", unit: "kts", description: "" },
    { label: "TTI", unit: "s", description: "" },
  ];

  const states =
    profile?.iff_states.map((state) => state.name) ??
    dilemma.key_variables.iff_certainty_levels;
  const classes =
    profile?.track_classifications.map((entry) => entry.name) ?? [
      "fast air",
      "cruise missile",
    ];

  return {
    scenario_name: `Mock run — ${dilemma.title} (${difficulty})`,
    situation_brief:
      "Mock scenario. No ANTHROPIC_API_KEY is configured, so these tracks are generated locally rather than by the model. The decision points below are taken straight from the knowledge base entry.",
    time_window_seconds: band.time_window_seconds.min,
    tracks: Array.from({ length: count }, (_, index) => {
      // Plausible-looking placeholders, one per declared readout field.
      const seeds = [
        30 + index * 25,
        90 - index * 12,
        12000 - index * 1500,
        420 + index * 60,
        band.time_window_seconds.min - index * 8,
      ];
      return {
        designator: `TK-${1000 + index * 137}`,
        iff_status: states[index % Math.max(states.length, 1)] ?? "unknown",
        classification: classes[index % Math.max(classes.length, 1)] ?? "unknown",
        readouts: fields.map((field, fieldIndex) => ({
          label: field.label,
          value: `${seeds[fieldIndex] ?? 0}${field.unit ? ` ${field.unit}` : ""}`,
        })),
        notes: index === 1 ? "Identification unresolved." : "Track stable.",
      };
    }),
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
