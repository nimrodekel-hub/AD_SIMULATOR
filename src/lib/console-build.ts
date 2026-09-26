import "server-only";
import { after } from "next/server";
import { describeAiError } from "@/lib/ai/client";
import { generateGuiTemplate, missingSlots } from "@/lib/ai/tasks/generate-gui";
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
 * Starts a console build, or says why it cannot.
 *
 * There are two ways a console now gets rebuilt: the console builder, where a
 * designer asks for a different screen, and the change agent, where they ask
 * for anything and part of it turns out to be about the screen. Both have to
 * pass the same checks and start the same job — an approved profile, stored
 * screenshots, not two builds at once — or the second way would be a second,
 * slightly different console builder that drifts from the first.
 *
 * The browser does not wait for the build itself. It takes a minute or more,
 * and a phone will not hold a connection that long, so this returns as soon
 * as the job is recorded and the work carries on under `after`.
 *
 * Callers must declare `maxDuration` on their route: `after` runs inside that
 * budget, so it is what actually bounds a build.
 */
export async function startConsoleBuild({
  systemId,
  requests,
  previousHtml,
}: {
  systemId: string;
  /** Every change asked for, oldest first. See the console builder for why all of them. */
  requests: string[];
  previousHtml?: string;
}): Promise<{ status: number; body: unknown }> {
  const system = await getSystem(systemId);
  if (!system) return { status: 404, body: { error: "System not found" } };

  /* The console is built from the screenshots and the profile together.
     Without the profile it would only look right, and a console that looks
     right while behaving wrong is the failure this whole step exists to
     prevent. */
  const profile = await getSystemProfile(systemId);
  if (!profile?.approved) {
    return {
      status: 409,
      body: {
        error:
          "Teach and approve this system's behaviour profile first — the console is built from how the system behaves, not only from how it looks.",
      },
    };
  }

  const screenshots = await loadScreenshots(systemId);
  if (screenshots.length === 0) {
    return {
      status: 409,
      body: {
        error:
          "This system has no reference screenshots stored. Upload them in the reference step first.",
      },
    };
  }

  // Two tabs, or a reload followed by a second press, must not start two
  // generations against the same system.
  const existing = await readGuiJob(systemId);
  if (existing?.status === "running" && !isStale(existing)) {
    return { status: 202, body: asReported(existing) };
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
        previousHtml,
      });

      await finishGuiJob(systemId, system.name, {
        html: draft.html,
        design_notes: draft.design_notes,
        screenshots: screenshots.map((shot) => shot.path),
        // A shell without its slots cannot host an exercise. Recorded rather
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

  return { status: 202, body: job };
}

/**
 * The request list a route was sent, cleaned.
 *
 * Capped at the last twenty: a thread longer than that is a conversation that
 * has gone in circles, and sending all of it to every rebuild would make each
 * one slower and dearer without making it better.
 */
export function cleanRequests(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .slice(-20)
    : [];
}
