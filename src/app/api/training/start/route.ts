import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { generateScenario } from "@/lib/ai/tasks/generate-scenario";
import {
  ClarificationRoundSchema,
  DifficultyLevelSchema,
} from "@/lib/domain/schemas";
import { getDilemma, getSystemProfile } from "@/lib/store/kb";
import { createSession } from "@/lib/store/sessions";

/** Instantiates a scenario from the matched dilemma and opens a session. */

export const maxDuration = 60;

const BodySchema = z.object({
  trainee_id: z.string().min(1),
  dilemma_id: z.string().min(1),
  requested_text: z.string().min(1),
  clarifications: z.array(ClarificationRoundSchema).default([]),
  difficulty: DifficultyLevelSchema,
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const dilemma = await getDilemma(parsed.data.dilemma_id);
  if (!dilemma) {
    return NextResponse.json({ error: "Dilemma not found" }, { status: 404 });
  }
  if (dilemma.status !== "approved") {
    // Only approved knowledge generates training. Belt and braces: the matcher
    // is already restricted to approved entries.
    return NextResponse.json(
      { error: "That dilemma has not been approved yet." },
      { status: 409 },
    );
  }

  try {
    // Only an approved profile governs generation. A draft is the designer
    // still working, and half-taught doctrine is worse than none.
    const profile = await getSystemProfile();
    const scenario = await generateScenario(
      dilemma,
      parsed.data.difficulty,
      profile?.approved ? profile : null,
    );
    const session = await createSession({
      traineeId: parsed.data.trainee_id,
      dilemmaEntryId: dilemma.id,
      requestedText: parsed.data.requested_text,
      clarificationRounds: parsed.data.clarifications,
      difficulty: parsed.data.difficulty,
      scenario,
    });
    return NextResponse.json({ session_id: session.id }, { status: 201 });
  } catch (reason) {
    return NextResponse.json({ error: describeAiError(reason) }, { status: 502 });
  }
}
