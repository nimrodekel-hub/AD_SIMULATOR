import { NextResponse, type NextRequest } from "next/server";
import { cleanRequests, startConsoleBuild } from "@/lib/console-build";
import { asReported, readGuiJob } from "@/lib/store/gui-job";

/**
 * Turns one system's stored references into its console shell.
 *
 * The browser does not wait for this. Generation takes a minute or more, and a
 * phone will not hold a connection that long — the screen locks, the tab is
 * suspended, and the request dies with a bare "Load failed" even though the
 * server was working perfectly. So POST starts the work and returns at once,
 * the work continues here until it is done, and GET reports where it got to.
 * Closing the page and coming back is now free.
 *
 * The screenshots are not uploaded here — they belong to the system and were
 * stored before it was described, so that the same images could inform the
 * behaviour profile. The build reads them back.
 *
 * The start itself lives in `startConsoleBuild`, shared with the change agent,
 * so a screen change asked for there goes through exactly these checks.
 *
 * Runs once per template, not per training run — the brief rules out
 * generating a GUI at runtime.
 */

/**
 * The ceiling for the work scheduled with `after`, not for the response.
 *
 * `after` runs inside this budget, so it is what actually bounds a generation.
 * The POST itself answers in about a second.
 */
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/gui/generate">,
) {
  const { systemId } = await ctx.params;

  let body: { requests?: unknown; previous_html?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  /* Every change the designer has asked for, oldest first — not just the
     newest. A revision that honours the current request while quietly undoing
     the previous one is how this conversation goes in circles, and the model
     can only avoid that if it can see what was already agreed. */
  const { status, body: reply } = await startConsoleBuild({
    systemId,
    requests: cleanRequests(body.requests),
    previousHtml: String(body.previous_html ?? "") || undefined,
  });
  return NextResponse.json(reply, { status });
}

/** Where the current generation got to. Safe to call as often as you like. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/gui/generate">,
) {
  const { systemId } = await ctx.params;
  return NextResponse.json(asReported(await readGuiJob(systemId)));
}
