import { NextResponse, type NextRequest } from "next/server";
import { describeAiError } from "@/lib/ai/client";
import {
  generateGuiTemplate,
  missingSlots,
} from "@/lib/ai/tasks/generate-gui";
import { getSystem, getSystemProfile, loadScreenshots } from "@/lib/store/kb";

/**
 * Turns one system's stored references into its console shell.
 *
 * The screenshots are not uploaded here any more — they belong to the system
 * and were stored before it was described, so that the same images could inform
 * the behaviour profile. This step reads them back.
 *
 * Runs once per template, not per training run — the brief rules out generating
 * a GUI at runtime.
 */

export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/gui/generate">,
) {
  const { systemId } = await ctx.params;
  const system = await getSystem(systemId);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  let body: { guidance?: string; previous_html?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

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

  try {
    const draft = await generateGuiTemplate({
      screenshots: screenshots.map(({ mediaType, base64 }) => ({
        mediaType,
        base64,
      })),
      profile,
      systemNameFictional: system.name,
      guidance: String(body.guidance ?? "").trim(),
      previousHtml: String(body.previous_html ?? "") || undefined,
    });

    // A shell without its slots cannot host a scenario. Report it rather than
    // letting the designer approve something that will render empty.
    const missing = missingSlots(draft.html);

    return NextResponse.json({
      html: draft.html,
      design_notes: draft.design_notes,
      screenshots: screenshots.map((shot) => shot.path),
      missing_slots: missing,
    });
  } catch (reason) {
    return NextResponse.json({ error: describeAiError(reason) }, { status: 502 });
  }
}
