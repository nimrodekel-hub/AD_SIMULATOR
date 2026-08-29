import { NextResponse, type NextRequest } from "next/server";
import { getSystem, listScreenshots, replaceScreenshots } from "@/lib/store/kb";

/**
 * The system's reference screenshots.
 *
 * They are uploaded once, before the system is described, and read twice: when
 * the designer's answers are interpreted, and again when the console is
 * generated. Uploading here rather than inside the console step is what lets
 * the questions be answered with the display already on the table.
 */

export const maxDuration = 60;

/**
 * Two is the fewest that shows a console has more than one view; eight is where
 * an extra screenshot stops saying anything new about a single console and only
 * adds tokens to every generation. The browser scales each one to what the
 * model actually reads before sending it, so the ceiling is about usefulness
 * rather than about size.
 */
const MIN_SCREENSHOTS = 2;
const MAX_SCREENSHOTS = 8;

/** Generous once the browser has scaled them; a guard, not a working limit. */
const MAX_BYTES_EACH = 4 * 1024 * 1024;

const ACCEPTED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/screenshots">,
) {
  const { systemId } = await ctx.params;
  const system = await getSystem(systemId);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form with screenshots." },
      { status: 400 },
    );
  }

  const files = form
    .getAll("screenshots")
    .filter((entry): entry is File => entry instanceof File);

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
        {
          error: `${file.name} is a ${file.type || "unknown"} file. Use PNG, JPEG, GIF or WebP.`,
        },
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
    const stored = await replaceScreenshots(
      systemId,
      await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      ),
    );
    return NextResponse.json({ screenshots: stored });
  } catch (reason) {
    return NextResponse.json(
      {
        error:
          reason instanceof Error
            ? reason.message
            : "Could not store the screenshots.",
      },
      { status: 502 },
    );
  }
}

/** What is currently stored, so the step can show it without re-uploading. */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/screenshots">,
) {
  const { systemId } = await ctx.params;
  return NextResponse.json({ screenshots: await listScreenshots(systemId) });
}
