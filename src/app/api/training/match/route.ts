import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import {
  CONFIDENCE_THRESHOLD,
  MAX_CLARIFICATION_ROUNDS,
  matchDilemma,
} from "@/lib/ai/tasks/match-dilemma";
import { ClarificationRoundSchema } from "@/lib/domain/schemas";
import { listApprovedDilemmas } from "@/lib/store/kb";

/**
 * Routes a trainee's free-text request to a dilemma.
 *
 * Returns one of three shapes, and the client renders whichever it gets:
 *   - `needs_clarification` — the matcher is unsure and has one question.
 *   - `matched`             — confident enough, or out of clarification rounds.
 *   - `no_dilemmas`         — nothing approved in the knowledge base yet.
 */

export const maxDuration = 60;

const BodySchema = z.object({
  request: z.string().min(1),
  clarifications: z.array(ClarificationRoundSchema).default([]),
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const dilemmas = await listApprovedDilemmas();
  if (dilemmas.length === 0) {
    return NextResponse.json({ status: "no_dilemmas" as const });
  }

  try {
    const match = await matchDilemma({
      request: parsed.data.request,
      clarifications: parsed.data.clarifications,
      dilemmas,
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
      dilemmas.find((entry) => entry.id === match.dilemma_entry_id) ??
      dilemmas[0];

    return NextResponse.json({
      status: "matched" as const,
      dilemma: { id: chosen.id, title: chosen.title },
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
