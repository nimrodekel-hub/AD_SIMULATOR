import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { DilemmaDraftSchema } from "@/lib/domain/schemas";
import { createDilemmaDraft, listDilemmas } from "@/lib/store/kb";

/** Collection endpoint for dilemma entries. */

const CreateSchema = z.object({
  draft: DilemmaDraftSchema,
  /** The conversation this was extracted from, kept for later audit. */
  transcript: z.string(),
});

export async function GET() {
  return NextResponse.json({ dilemmas: await listDilemmas() });
}

export async function POST(request: NextRequest) {
  const parsed = CreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid dilemma", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const entry = await createDilemmaDraft(
      parsed.data.draft,
      parsed.data.transcript,
    );
    return NextResponse.json({ entry }, { status: 201 });
  } catch (reason) {
    return NextResponse.json({ error: describe(reason) }, { status: 500 });
  }
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Failed to save the dilemma.";
}
