import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import {
  CONFIDENCE_THRESHOLD,
  MAX_CLARIFICATION_ROUNDS,
  matchScenario,
} from "@/lib/ai/tasks/match-scenario";
import { ClarificationRoundSchema } from "@/lib/domain/schemas";
import { getSystem, listApprovedScenarios } from "@/lib/store/kb";

/**
 * Routes a trainee's free-text request to a scenario.
 *
 * Matching is scoped to the system the trainee chose. A scenario taught inside
 * one system assumes that system's identification states, actions and numbers,
 * so offering it against another would train someone on a procedure their
 * console does not have.
 *
 * Returns one of three shapes, and the client renders whichever it gets:
 *   - `needs_clarification` — the matcher is unsure and has one question.
 *   - `matched`             — confident enough, or out of clarification rounds.
 *   - `no_scenarios`         — nothing approved for this system yet.
 */

/**
 * Every route that calls the model gets the long ceiling.
 *
 * A model call is the only thing here that takes minutes, and the platform
 * kills the function when this elapses. Raising the ceiling is not the same as
 * surviving a slow step, though: past about a minute it is the browser that
 * gives up, not the server. Measured against production this route stays well
 * inside that, so it answers in the request. The three that do not — extracting
 * a scenario, generating an exercise and building a console — hand back a job
 * record instead and let the page ask how it is getting on. See
 * `lib/store/job.ts`.
 */
export const maxDuration = 300;

const BodySchema = z.object({
  system_id: z.string().min(1),
  request: z.string().min(1),
  clarifications: z.array(ClarificationRoundSchema).default([]),
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const system = await getSystem(parsed.data.system_id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const scenarios = await listApprovedScenarios(parsed.data.system_id);
  if (scenarios.length === 0) {
    return NextResponse.json({ status: "no_scenarios" as const });
  }

  try {
    const match = await matchScenario({
      request: parsed.data.request,
      clarifications: parsed.data.clarifications,
      scenarios,
    });

    // The brief caps clarification at three rounds. Once spent, commit to the
    // closest match and tell the trainee what was chosen rather than looping.
    const roundsSpent = parsed.data.clarifications.length;
    const outOfRounds = roundsSpent >= MAX_CLARIFICATION_ROUNDS;
    const unsure =
      match.confidence < CONFIDENCE_THRESHOLD &&
      match.clarifying_question.length > 0;

    if (unsure && !outOfRounds) {
      return NextResponse.json({
        status: "needs_clarification" as const,
        question: match.clarifying_question,
        rounds_remaining: MAX_CLARIFICATION_ROUNDS - roundsSpent,
      });
    }

    const chosen =
      scenarios.find((entry) => entry.id === match.scenario_entry_id) ??
      scenarios[0];

    return NextResponse.json({
      status: "matched" as const,
      scenario: { id: chosen.id, title: chosen.title },
      confidence: match.confidence,
      reasoning: match.reasoning,
      suggested_difficulty: match.suggested_difficulty,
      /** True when rounds ran out rather than confidence being reached. */
      settled_without_confidence: outOfRounds && unsure,
    });
  } catch (reason) {
    return NextResponse.json({ error: describeAiError(reason) }, { status: 502 });
  }
}
