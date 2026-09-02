import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { missingSlots, sanitiseHtml } from "@/lib/ai/tasks/generate-gui";
import { getGuiTemplate, getSystem, saveGuiTemplate } from "@/lib/store/kb";
import { GuiRevisionSchema, type GuiTemplate } from "@/lib/domain/schemas";

/** One system's simulated console: read, save, approve. */

const SaveSchema = z.object({
  generated_ui_code: z.string().min(1),
  source_screenshots: z.array(z.string()),
  approved: z.boolean(),
  /**
   * The conversation that produced this console.
   *
   * Stored with it so that reopening the page picks the thread back up: the
   * next request the designer makes then arrives with everything already
   * agreed, instead of asking a model that has forgotten it to change one
   * thing without undoing the rest.
   */
  revisions: z.array(GuiRevisionSchema).default([]),
});

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/gui">,
) {
  const { systemId } = await ctx.params;
  return NextResponse.json({ template: await getGuiTemplate(systemId) });
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/gui">,
) {
  const { systemId } = await ctx.params;
  const system = await getSystem(systemId);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const parsed = SaveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid template" }, { status: 400 });
  }

  const html = sanitiseHtml(parsed.data.generated_ui_code);

  // Approving a shell with missing slots would leave trainees looking at an
  // empty console, so the gate is here rather than only in the UI.
  if (parsed.data.approved) {
    const missing = missingSlots(html);
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot approve: the console is missing the ${missing.join(", ")} slot${missing.length === 1 ? "" : "s"}. Regenerate before approving.`,
        },
        { status: 409 },
      );
    }
  }

  const existing = await getGuiTemplate(systemId);
  const template: GuiTemplate = {
    id: systemId,
    source_screenshots: parsed.data.source_screenshots,
    generated_ui_code: html,
    approved: parsed.data.approved,
    created_at: existing?.created_at ?? new Date().toISOString(),
    revisions: parsed.data.revisions,
  };

  try {
    await saveGuiTemplate(systemId, template, system.name);
    return NextResponse.json({ template });
  } catch (reason) {
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : "Failed to save." },
      { status: 500 },
    );
  }
}
