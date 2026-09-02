import { NextResponse, type NextRequest } from "next/server";
import {
  addScreenshots,
  getSystem,
  listScreenshots,
  removeScreenshot,
  replaceScreenshots,
} from "@/lib/store/kb";

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
 * How much reference a system may carry.
 *
 * Two is the fewest that shows a console has more than one view. The ceiling
 * used to be eight, on the theory that a ninth screenshot stops saying
 * anything new — which turned out to be wrong in the way that mattered: the
 * generated console was not close enough to the real one, and the reason was
 * that the model had too little to look at. Different views carry different
 * panels, different states, and colours that only appear when something is
 * happening.
 *
 * So the ceiling is now set by what the model can usefully read in one call
 * rather than by a guess about diminishing returns, and uploads append, so a
 * designer is not limited to what fits in a single 4.5 MB request.
 */
const MIN_SCREENSHOTS = 2;
const MAX_SCREENSHOTS = 20;

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

  // Adding keeps what is already stored; the default replaces it. Either way
  // the limits are checked against the set the system ends up with.
  const adding = form.get("mode") === "add";
  const already = adding ? (await listScreenshots(systemId)).length : 0;
  const total = already + files.length;

  if (files.length === 0) {
    return NextResponse.json(
      { error: "No screenshots were attached." },
      { status: 400 },
    );
  }
  if (total < MIN_SCREENSHOTS) {
    return NextResponse.json(
      {
        error: `A system needs at least ${MIN_SCREENSHOTS} references — this would leave it with ${total}.`,
      },
      { status: 400 },
    );
  }
  if (total > MAX_SCREENSHOTS) {
    return NextResponse.json(
      {
        error: adding
          ? `This system already has ${already} references, and ${MAX_SCREENSHOTS} is the most it can hold. Remove some first, or send ${MAX_SCREENSHOTS - already} at most.`
          : `Upload at most ${MAX_SCREENSHOTS} screenshots — you sent ${files.length}.`,
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
    const incoming = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    const stored = adding
      ? await addScreenshots(systemId, incoming)
      : await replaceScreenshots(systemId, incoming);
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

/** Drops a single reference, so a bad view can go without redoing the set. */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/screenshots">,
) {
  const { systemId } = await ctx.params;
  if (!(await getSystem(systemId))) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const path = request.nextUrl.searchParams.get("path") ?? "";
  const name = path.split("/").pop() ?? "";
  if (!name) {
    return NextResponse.json(
      { error: "Which screenshot? Pass its stored path." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({
      screenshots: await removeScreenshot(systemId, name),
    });
  } catch (reason) {
    return NextResponse.json(
      {
        error:
          reason instanceof Error
            ? reason.message
            : "Could not remove the screenshot.",
      },
      { status: 502 },
    );
  }
}
