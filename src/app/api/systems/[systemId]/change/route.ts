import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { proposeChange } from "@/lib/ai/tasks/change-system";
import { gapMessage } from "@/lib/domain/profile-readiness";
import { getGuiTemplate, getSystem, getSystemProfile } from "@/lib/store/kb";
import { blockerOf, draftOf, evaluateChange } from "@/lib/system-change";

/**
 * Proposes a change to one system from a request in plain words.
 *
 * **Saves nothing.** It returns what would change — every edit as before and
 * after, the screen instruction it would hand the console builder, and
 * anything it could not do — so the designer decides with the actual change
 * in front of them. Applying is a separate call, and it re-checks everything
 * against the profile as it is by then.
 *
 * Synchronous, unlike a console build: this reads no images and writes one
 * short list, so it answers in well under a minute.
 */
export const maxDuration = 300;

const BodySchema = z.object({ request: z.string().trim().min(1).max(4000) });

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/change">,
) {
  const { systemId } = await ctx.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Say what should change." }, { status: 400 });
  }

  const [system, profile, gui] = await Promise.all([
    getSystem(systemId),
    getSystemProfile(systemId),
    getGuiTemplate(systemId),
  ]);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }
  if (!profile) {
    return NextResponse.json(
      {
        error:
          "This system has not been described yet, so there is nothing to change. Answer the questions on the behaviour page first.",
      },
      { status: 409 },
    );
  }

  try {
    const proposal = await proposeChange({
      request: parsed.data.request,
      profile: draftOf(profile),
      systemName: system.name,
      hasConsole: !!gui,
    });

    const evaluated = evaluateChange(profile, proposal.edits);

    return NextResponse.json({
      summary: proposal.summary,
      edits: proposal.edits,
      changes: evaluated.changes,
      console_request: proposal.console_request.trim(),
      cannot: proposal.cannot.filter((line) => line.trim().length > 0),
      failed: evaluated.failed,
      invalid: evaluated.invalid,
      new_gaps:
        evaluated.newGaps.length > 0 ? gapMessage(evaluated.newGaps) : null,
      /* Worked out here as well as on apply, so the designer is told before
         pressing anything that this one cannot go in as it stands. */
      blocker: proposal.edits.length > 0 ? blockerOf(evaluated, profile) : null,
    });
  } catch (reason) {
    return NextResponse.json(
      { error: describeAiError(reason) },
      { status: 502 },
    );
  }
}
