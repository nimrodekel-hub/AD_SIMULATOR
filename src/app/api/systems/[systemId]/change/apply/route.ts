import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { startConsoleBuild } from "@/lib/console-build";
import {
  getGuiTemplate,
  getSystem,
  getSystemProfile,
  saveSystemProfile,
} from "@/lib/store/kb";
import { blockerOf, evaluateChange } from "@/lib/system-change";

/**
 * Applies a change the designer has seen and accepted.
 *
 * The edits are applied again, here, to the profile **as it is now** — not
 * taken from the browser as a finished profile. What the designer approved was
 * a list of before-and-after lines, and re-running the edits is how the save
 * matches that list: if the profile moved in between, an edit that no longer
 * fits is refused rather than written over somebody else's work.
 *
 * An approved profile stays approved. The designer has just approved this
 * change, line by line; sending them back through the whole form to approve
 * the profile again would be asking for the same yes twice. The one exception
 * is a change that would remove a figure the simulation runs on, which is
 * refused outright — see `blockerOf`.
 *
 * The screen part, if there is one, is handed to the console builder through
 * the same start as its own requests, and lands in its thread like any other
 * request — so the builder shows it, and the designer reviews the rebuilt
 * console where they always do.
 */
export const maxDuration = 300;

const BodySchema = z.object({
  request: z.string().trim().min(1).max(4000),
  edits: z
    .array(
      z.object({
        op: z.enum(["set", "add", "remove"]),
        path: z.string(),
        value_json: z.string(),
      }),
    )
    .max(60),
  console_request: z.string().trim().max(2000).default(""),
});

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[systemId]/change/apply">,
) {
  const { systemId } = await ctx.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid change" }, { status: 400 });
  }
  const { edits, console_request } = parsed.data;

  const [system, profile] = await Promise.all([
    getSystem(systemId),
    getSystemProfile(systemId),
  ]);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }
  if (!profile) {
    return NextResponse.json(
      { error: "This system has not been described yet." },
      { status: 409 },
    );
  }

  /* ---- The behaviour half ---------------------------------------- */
  let saved = 0;
  if (edits.length > 0) {
    const evaluated = evaluateChange(profile, edits);
    const blocker = blockerOf(evaluated, profile);
    if (blocker || !evaluated.draft) {
      return NextResponse.json(
        { error: blocker ?? "The change could not be applied." },
        { status: 409 },
      );
    }

    saved = evaluated.changes.length;
    if (saved > 0) {
      try {
        await saveSystemProfile(
          systemId,
          {
            ...evaluated.draft,
            id: systemId,
            approved: profile.approved,
            source_answers: profile.source_answers,
            created_at: profile.created_at,
            approved_at: profile.approved ? new Date().toISOString() : null,
          },
          system.name,
          /* The designer's own words, then what they came to — so the
             repository history answers "why is this different" without
             anyone having to remember. */
          [
            `Asked for: ${parsed.data.request}`,
            "",
            ...evaluated.changes.map(
              (change) => `- ${change.where}: ${change.before} → ${change.after}`,
            ),
          ].join("\n"),
        );
      } catch (reason) {
        return NextResponse.json(
          {
            error:
              reason instanceof Error ? reason.message : "Failed to save.",
          },
          { status: 500 },
        );
      }
    }
  }

  /* ---- The screen half ------------------------------------------- */
  let console: { started: boolean; error?: string } = { started: false };
  if (console_request) {
    /* After the save, so the rebuild reads the behaviour just approved: a
       request for "room for the reload button" is built against a profile
       that has one. */
    const gui = await getGuiTemplate(systemId);
    const { status, body } = await startConsoleBuild({
      systemId,
      requests: [
        ...(gui?.revisions ?? []).map((entry) => entry.request),
        console_request,
      ].slice(-20),
      previousHtml: gui?.generated_ui_code || undefined,
    });
    console =
      status === 202
        ? { started: true }
        : {
            started: false,
            error:
              (body as { error?: string } | null)?.error ??
              "The console could not be rebuilt.",
          };
  }

  return NextResponse.json({ saved, console });
}
