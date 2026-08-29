import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LessonSchema } from "@/lib/domain/schemas";
import {
  getGeneralKnowledge,
  saveGeneralKnowledge,
} from "@/lib/store/general-knowledge";

/**
 * The knowledge that sits above every system.
 *
 * No model call here — this is the designer's own writing, saved as they typed
 * it. Nothing is extracted, interpreted or rewritten, because the whole point
 * of this document is that a person owns it.
 */

export async function GET() {
  return NextResponse.json({ knowledge: await getGeneralKnowledge() });
}

const SaveSchema = z.object({
  briefing: z.string(),
  // A lesson may arrive without an id — the store mints one. Ids are never
  // minted in the browser, so two tabs cannot invent the same one.
  lessons: z.array(LessonSchema.partial({ id: true })),
});

export async function PUT(request: NextRequest) {
  const parsed = SaveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid knowledge document", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const knowledge = await saveGeneralKnowledge({
      briefing: parsed.data.briefing,
      lessons: parsed.data.lessons.map((lesson) => ({ ...lesson, id: lesson.id ?? "" })),
    });
    return NextResponse.json({ knowledge });
  } catch (reason) {
    return NextResponse.json(
      {
        error:
          reason instanceof Error ? reason.message : "Could not save the knowledge.",
      },
      { status: 500 },
    );
  }
}
