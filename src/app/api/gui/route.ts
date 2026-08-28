import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { missingSlots, sanitiseHtml } from "@/lib/ai/tasks/generate-gui";
import { getGuiTemplate, saveGuiTemplate } from "@/lib/store/kb";
import type { GuiTemplate } from "@/lib/domain/schemas";

/** The single simulated-console template: read, save, approve. */

const SaveSchema = z.object({
  system_name_fictional: z.string().min(1),
  generated_ui_code: z.string().min(1),
  source_screenshots: z.array(z.string()),
  approved: z.boolean(),
});

export async function GET() {
  return NextResponse.json({ template: await getGuiTemplate() });
}

export async function POST(request: NextRequest) {
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

  const existing = await getGuiTemplate();
  const template: GuiTemplate = {
    id: existing?.id ?? crypto.randomUUID(),
    system_name_fictional: parsed.data.system_name_fictional,
    source_screenshots: parsed.data.source_screenshots,
    generated_ui_code: html,
    approved: parsed.data.approved,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };

  try {
    await saveGuiTemplate(template);
    return NextResponse.json({ template });
  } catch (reason) {
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : "Failed to save." },
      { status: 500 },
    );
  }
}
