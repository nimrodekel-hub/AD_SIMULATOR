import { NextResponse, after, type NextRequest } from "next/server";
import { describeAiError } from "@/lib/ai/client";
import {
  generateGuiTemplate,
  missingSlots,
} from "@/lib/ai/tasks/generate-gui";
import { getSystem, getSystemProfile, loadScreenshots } from "@/lib/store/kb";
import {
  asReported,
  failGuiJob,
  finishGuiJob,
  isStale,
  readGuiJob,
  startGuiJob,
} from "@/lib/store/gui-job";

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
 * behaviour profile. This step reads them back.
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
  const system = await getSystem(systemId);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

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
  const requests = Array.isArray(body.requests)
    ? body.requests
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(-20)
    : [];

  // The console is built from the screenshots and the profile together. Without
  // the profile it would only look right, and a console that looks right while
  // behaving wrong is the failure this whole step exists to prevent.
  const profile = await getSystemProfile(systemId);
  if (!profile?.approved) {
    return NextResponse.json(
      {
        error:
          "Teach and approve this system's behaviour profile first — the console is built from how the system behaves, not only from how it looks.",
      },
      { status: 409 },
    );
  }

  const screenshots = await loadScreenshots(systemId);
  if (screenshots.length === 0) {
    return NextResponse.json(
      {
        error:
          "This system has no reference screenshots stored. Upload them in the reference step first.",
      },
      { status: 409 },
    );
  }

  // Two tabs, or a reload followed by a second press, must not start two
  // generations against the same system.
  const existing = await readGuiJob(systemId);
  if (existing?.status === "running" && !isStale(existing)) {
    return NextResponse.json(asReported(existing), { status: 202 });
  }

  const job = await startGuiJob(systemId, system.name);

  after(async () => {
    try {
      const draft = await generateGuiTemplate({
        screenshots: screenshots.map(({ mediaType, base64 }) => ({
          mediaType,
          base64,
        })),
        profile,
        systemNameFictional: system.name,
        requests,
        previousHtml: String(body.previous_html ?? "") || undefined,
      });

      await finishGuiJob(systemId, system.name, {
        html: draft.html,
        design_notes: draft.design_notes,
        screenshots: screenshots.map((shot) => shot.path),
        // A shell without its slots cannot host a scenario. Recorded rather
        // than thrown, so the designer sees what is wrong and can regenerate.
        missing_slots: missingSlots(draft.html),
        // Stored with the build, so whichever screen accepts it can write the
        // whole thread back rather than only what that page happened to hold.
        requests,
      });
    } catch (reason) {
      await failGuiJob(systemId, system.name, describeAiError(reason));
    }
  });

  return NextResponse.json(job, { status: 202 });
}

/** Where the current generation got to. Safe to call as often as you like. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/gui/generate">,
) {
  const { systemId } = await ctx.params;
  return NextResponse.json(asReported(await readGuiJob(systemId)));
}
