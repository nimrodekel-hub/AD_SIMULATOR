import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { extractSystemProfile } from "@/lib/ai/tasks/learn-system";
import { getSystem, loadScreenshots } from "@/lib/store/kb";

/** Turns one system's answers into a structured behaviour profile. */

/**
 * Every route that calls the model gets the long ceiling.
 *
 * A model call is the only thing here that takes minutes, and the platform
 * kills the function when this elapses. Raising the ceiling is not the same as
 * surviving a slow step, though: past about a minute it is the browser that
 * gives up, not the server. Measured against production this route stays well
 * inside that, so it answers in the request. The three that do not — extracting
 * a dilemma, generating a scenario and building a console — hand back a job
 * record instead and let the page ask how it is getting on. See
 * `lib/store/job.ts`.
 */
export const maxDuration = 300;

/**
 * How many references the model is shown while reading the answers.
 *
 * Images are the expensive part of this call, and three is enough for what the
 * screenshots are here to settle — the column labels, their order, the
 * identification colours — because those are the same in every view of the same
 * console. A fourth costs seconds and says nothing new. The console step, which
 * cares about the whole look rather than the wording, still gets all of them.
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
