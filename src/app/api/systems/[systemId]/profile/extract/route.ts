import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { extractSystemProfile } from "@/lib/ai/tasks/learn-system";
import { getSystem, loadScreenshots } from "@/lib/store/kb";

/** Turns one system's answers into a structured behaviour profile. */

export const maxDuration = 60;

/**
 * How many references the model is shown while reading the answers.
 *
 * The platform cuts this request off at sixty seconds, and images are the
 * expensive part of it. Three is enough for what the screenshots are here to
 * settle — the column labels, their order, the identification colours — because
 * those are the same in every view of the same console. A fourth costs time and
 * says nothing new. The console step, which cares about the whole look, still
 * gets all of them.
 */
const MAX_REFERENCES_READ = 3;

const BodySchema = z.object({
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
  open_notes: z.string(),
});

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/profile/extract">,
) {
  const { systemId } = await ctx.params;
  const system = await getSystem(systemId);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const answered = parsed.data.answers.filter(
    (entry) => entry.answer.trim().length > 0,
  );
  if (answered.length === 0 && parsed.data.open_notes.trim().length === 0) {
    return NextResponse.json(
      { error: "Answer at least one question before extracting." },
      { status: 400 },
    );
  }

  try {
    // The system's stored references, if it has any. They settle what the
    // display actually reads while the answers are being interpreted, rather
    // than only later when the console is drawn.
    const screenshots = (await loadScreenshots(systemId)).slice(
      0,
      MAX_REFERENCES_READ,
    );

    const draft = await extractSystemProfile(
      system.name,
      parsed.data.answers,
      parsed.data.open_notes,
      screenshots,
    );
    return NextResponse.json({ draft });
  } catch (reason) {
    return NextResponse.json({ error: describeAiError(reason) }, { status: 502 });
  }
}
