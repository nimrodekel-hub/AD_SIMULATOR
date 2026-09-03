import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { describeAiError } from "@/lib/ai/client";
import { extractScenario } from "@/lib/ai/tasks/learn-scenario";
import { getSystem } from "@/lib/store/kb";
import {
  asReported,
  clearScenarioJob,
  failScenarioJob,
  finishScenarioJob,
  isStale,
  readScenarioJob,
  startScenarioJob,
} from "@/lib/store/scenario-job";

/**
 * Turns a finished interview transcript into a structured record for review.
 *
 * The browser does not wait for it. Reading a whole interview and extracting a
 * scenario from it measures at a minute and a half to nearly two against
 * production — far past what a phone will hold a connection open for. So POST
 * starts the work and returns at once, the work continues here until it is
 * done, and GET reports where it got to.
 *
 * It hangs off the system rather than sitting under `/api/designer`, because
 * the job has to be filed somewhere and the system is what it belongs to: this
 * is the scenario being taught inside that system.
 */

/**
 * The ceiling for the work scheduled with `after`, not for the response.
 *
 * `after` runs inside this budget, so it is what actually bounds an extraction.
 * The POST itself answers in about a second.
 */
export const maxDuration = 300;

const BodySchema = z.object({ transcript: z.string().min(1) });

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/scenarios/extract">,
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
  const { transcript } = parsed.data;

  // A second press, or a reload followed by one, must not start a second
  // extraction of the same conversation.
  const existing = await readScenarioJob(systemId);
  if (existing?.status === "running" && !isStale(existing)) {
    return NextResponse.json(asReported(existing), { status: 202 });
  }

  const job = await startScenarioJob(systemId, system.name);

  after(async () => {
    try {
      const draft = await extractScenario(transcript);
      await finishScenarioJob(systemId, system.name, { draft, transcript });
    } catch (reason) {
      await failScenarioJob(systemId, system.name, describeAiError(reason));
    }
  });

  return NextResponse.json(job, { status: 202 });
}

/** Where the current extraction got to. Safe to call as often as you like. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/scenarios/extract">,
) {
  const { systemId } = await ctx.params;
  return NextResponse.json(asReported(await readScenarioJob(systemId)));
}

/**
 * Discards the current extraction.
 *
 * Sent once its draft has been saved, or when the designer chooses to go back
 * to the conversation instead of reviewing it. Either way the record has done
 * its job and should not meet them again on the next visit.
 */
export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/scenarios/extract">,
) {
  const { systemId } = await ctx.params;
  const system = await getSystem(systemId);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }
  await clearScenarioJob(systemId, system.name);
  return NextResponse.json({ status: "idle" as const });
}
