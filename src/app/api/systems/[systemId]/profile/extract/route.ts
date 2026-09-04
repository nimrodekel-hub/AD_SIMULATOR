import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { extractSystemNarrative } from "@/lib/ai/tasks/learn-system";
import { gapMessage, simulationGaps } from "@/lib/domain/profile-readiness";
import {
  EngagementDoctrineSchema,
  IffInterrogationSchema,
  IffStateSchema,
  OperatorCommandsSchema,
  SensorCoverageSchema,
  TrackClassificationSchema,
  TrackReadoutFieldSchema,
} from "@/lib/domain/schemas";
import { getSystem, loadScreenshots } from "@/lib/store/kb";

/**
 * Turns one system's written answers into the prose half of its profile.
 *
 * The measured half — sensor coverage, track classes, readout columns, the
 * engagement envelope — never reaches the model. The designer entered those
 * into fields, so they are already exact; this route takes them only to hand
 * back untouched, so the caller assembles one complete draft from one response.
 * A number cannot be misread if nothing reads it.
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

/**
 * How many references the model is shown.
 *
 * Images are the expensive part of this call, and it now needs them for less
 * than it did: the columns and the identification states are typed in rather
 * than read off. What is left is context for the prose, and three views give
 * that as well as eight.
 */
const MAX_REFERENCES_READ = 3;

const BodySchema = z.object({
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
  open_notes: z.string(),
  /** What the designer entered directly. Passed through, never interpreted. */
  spec: z.object({
    track_classifications: z.array(TrackClassificationSchema),
    iff_states: z.array(IffStateSchema),
    iff_interrogation: IffInterrogationSchema,
    operator_commands: OperatorCommandsSchema,
    track_readout_fields: z.array(TrackReadoutFieldSchema),
    sensor: SensorCoverageSchema,
    engagement: EngagementDoctrineSchema,
  }),
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
    return NextResponse.json(
      { error: "Invalid request body", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const answered = parsed.data.answers.filter(
    (entry) => entry.answer.trim().length > 0,
  );
  if (answered.length === 0 && parsed.data.open_notes.trim().length === 0) {
    return NextResponse.json(
      { error: "Answer at least one question before building the profile." },
      { status: 400 },
    );
  }

  // The figures are checked here rather than only at approval, because this is
  // the step that costs money: reading the answers takes half a minute of
  // model time, and there is no sense spending it on a specification that
  // cannot be approved when it comes back.
  const gaps = simulationGaps(parsed.data.spec);
  if (gaps.length > 0) {
    return NextResponse.json({ error: gapMessage(gaps), gaps }, { status: 400 });
  }

  try {
    const screenshots = (await loadScreenshots(systemId)).slice(
      0,
      MAX_REFERENCES_READ,
    );

    const narrative = await extractSystemNarrative(
      system.name,
      parsed.data.answers,
      parsed.data.open_notes,
      parsed.data.spec,
      screenshots,
    );

    // One complete draft back: the designer's own numbers, unchanged, plus the
    // prose the model wrote. The caller never has to stitch the two halves.
    return NextResponse.json({
      draft: { ...parsed.data.spec, ...narrative },
    });
  } catch (reason) {
    return NextResponse.json({ error: describeAiError(reason) }, { status: 502 });
  }
}
