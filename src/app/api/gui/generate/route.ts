import { NextResponse, type NextRequest } from "next/server";
import { describeAiError } from "@/lib/ai/client";
import {
  generateGuiTemplate,
  missingSlots,
} from "@/lib/ai/tasks/generate-gui";
import { saveScreenshot } from "@/lib/store/kb";

/**
 * Turns reference screenshots into a console shell.
 *
 * Runs once per template, not per training run — the brief rules out generating
 * a GUI at runtime.
 */

export const maxDuration = 60;

/** The brief asks for 2-5 screenshots. */
const MIN_SCREENSHOTS = 2;
const MAX_SCREENSHOTS = 5;
/** Comfortably inside the API's request ceiling, with five images in flight. */
const MAX_BYTES_EACH = 4 * 1024 * 1024;

const ACCEPTED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form with screenshots." },
      { status: 400 },
    );
  }

  const systemName = String(form.get("system_name") ?? "").trim();
  if (!systemName) {
    return NextResponse.json(
      { error: "Give the simulated system a name first." },
      { status: 400 },
    );
  }

  const files = form.getAll("screenshots").filter((f): f is File => f instanceof File);

  if (files.length < MIN_SCREENSHOTS || files.length > MAX_SCREENSHOTS) {
    return NextResponse.json(
      {
        error: `Upload between ${MIN_SCREENSHOTS} and ${MAX_SCREENSHOTS} screenshots — you sent ${files.length}.`,
      },
      { status: 400 },
    );
  }

  for (const file of files) {
    if (!ACCEPTED.has(file.type)) {
      return NextResponse.json(
        { error: `${file.name} is a ${file.type || "unknown"} file. Use PNG, JPEG, GIF or WebP.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES_EACH) {
      return NextResponse.json(
        { error: `${file.name} is larger than 4 MB. Scale it down and try again.` },
        { status: 400 },
      );
    }
  }

  try {
    // Keep the references alongside the template: a future regenerate, or an
    // argument about what the console was based on, both need the originals.
    const stored = await Promise.all(
      files.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const path = await saveScreenshot(file.name, bytes);
        return {
          path,
          mediaType: file.type,
          base64: Buffer.from(bytes).toString("base64"),
        };
      }),
    );

    const draft = await generateGuiTemplate({
      screenshots: stored.map(({ mediaType, base64 }) => ({ mediaType, base64 })),
      systemNameFictional: systemName,
      guidance: String(form.get("guidance") ?? "").trim(),
      previousHtml: String(form.get("previous_html") ?? "") || undefined,
    });

    // A shell without its slots cannot host a scenario. Report it rather than
    // letting the designer approve something that will render empty.
    const missing = missingSlots(draft.html);

    return NextResponse.json({
      html: draft.html,
      design_notes: draft.design_notes,
      screenshots: stored.map((shot) => shot.path),
      missing_slots: missing,
    });
  } catch (reason) {
    return NextResponse.json({ error: describeAiError(reason) }, { status: 502 });
  }
}
