import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { extractDilemma } from "@/lib/ai/tasks/learn-dilemma";

/** Turns a finished interview transcript into a structured record for review. */

export const maxDuration = 60;

const BodySchema = z.object({
  transcript: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const draft = await extractDilemma(parsed.data.transcript);
    return NextResponse.json({ draft });
  } catch (reason) {
    return NextResponse.json({ error: describeAiError(reason) }, { status: 502 });
  }
}
