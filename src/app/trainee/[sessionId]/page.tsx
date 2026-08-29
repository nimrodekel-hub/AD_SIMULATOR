import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { LiveRun } from "@/components/live-run";
import { getGuiTemplate, getSystemProfile } from "@/lib/store/kb";
import { getSession } from "@/lib/store/sessions";

export const dynamic = "force-dynamic";

/**
 * The operator's position.
 *
 * Everything the run needs is fetched here and handed down: the approved
 * profile, which is where every rule of the simulation comes from, and the
 * approved console shell if the designer built one. The page itself does no
 * work — the run is live and belongs entirely to the browser.
 */
export default async function RunPage({
  params,
}: PageProps<"/trainee/[sessionId]">) {
  const { sessionId } = await params;
  const session = await getSession(sessionId);
  if (!session) notFound();

  // A finished run is not replayable — reopening it shows the debrief instead
  // of quietly letting the trainee fly the same engagement twice.
  if (session.status === "completed") {
    redirect(`/trainee/${sessionId}/debrief`);
  }

  // Only approved artefacts reach a trainee. A draft is the designer still
  // working, and the knowledge base follows the same rule.
  const [template, profile] = await Promise.all([
    getGuiTemplate(session.system_id),
    getSystemProfile(session.system_id),
  ]);

  /* A run created before the simulator existed has no kinematics, so there is
     nothing to fly. Rather than render an empty scope, say so plainly and let
     them start a fresh run — the old multiple-choice renderer is gone, and
     pretending otherwise would waste their time. */
  if (session.scenario_instance.live_tracks.length === 0) {
    return (
      <ScreenShell
        theme="ops"
        eyebrow="Trainee"
        title="This run predates the simulator"
        subtitle="It was recorded as a set of questions rather than a live engagement."
      >
        <p className="prose-block text-sm">
          Start a new run and it will be laid out as a real engagement: tracks
          that close in real time, on the scope, with the clock running.
        </p>
        <Link className="btn btn-primary mt-6 inline-block" href="/trainee">
          Back to training
        </Link>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      theme="ops"
      eyebrow="Trainee · Live engagement"
      title={session.scenario_instance.scenario_name}
      contained={false}
      fullHeight
    >
      <LiveRun
        session={session}
        profile={profile?.approved ? profile : null}
        templateHtml={usableConsole(template?.approved ? template.generated_ui_code : undefined)}
      />
    </ScreenShell>
  );
}

/**
 * Whether a console shell can host a live engagement.
 *
 * Consoles built before the simulator existed have no `scope` slot: their air
 * picture was a table, because that was all there was to show. Rendering a
 * radar display into whatever space is left over gives a scope a few hundred
 * pixels tall in the corner of a panel meant for rows of text, which is worse
 * than not using the shell at all.
 *
 * So an out-of-date console is declined and the built-in operations layout
 * runs instead. The designer is told on their console screen that rebuilding
 * it will give the picture a proper home.
 */
function usableConsole(html: string | undefined): string | undefined {
  if (!html) return undefined;
  return html.includes('data-slot="scope"') ? html : undefined;
}
