import { notFound, redirect } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { ScenarioRun } from "@/components/scenario-run";
import { getGuiTemplate, getSystemProfile } from "@/lib/store/kb";
import { getSession } from "@/lib/store/sessions";

export const dynamic = "force-dynamic";

/** Written out so Tailwind sees each literal class name. */
const TONE_CLASS = {
  friendly: "status-ok",
  neutral: "status-warn",
  caution: "status-warn",
  hostile: "status-danger",
} as const;

export default async function RunPage({
  params,
}: PageProps<"/trainee/[sessionId]">) {
  const { sessionId } = await params;
  const session = await getSession(sessionId);
  if (!session) notFound();

  // A finished run is not replayable — reopening it shows the debrief instead
  // of quietly letting the trainee answer the same scenario twice.
  if (session.status === "completed") {
    redirect(`/trainee/${sessionId}/debrief`);
  }

  // Only approved artefacts reach a trainee. A draft is the designer still
  // working, and the knowledge base follows the same rule.
  const [template, profile] = await Promise.all([
    getGuiTemplate(session.system_id),
    getSystemProfile(session.system_id),
  ]);
  const templateHtml = template?.approved
    ? template.generated_ui_code
    : undefined;

  /* The designer said how urgently each identification state should read.
     Resolved here rather than guessed from the wording in the browser. */
  const iffTones = profile?.approved
    ? Object.fromEntries(
        profile.iff_states.map((state) => [
          state.name.toLowerCase(),
          TONE_CLASS[state.tone],
        ]),
      )
    : undefined;

  return (
    <ScreenShell
      theme="ops"
      eyebrow="Trainee · Live run"
      title={session.scenario_instance.scenario_name}
      contained={false}
    >
      <ScenarioRun
        session={session}
        templateHtml={templateHtml}
        iffTones={iffTones}
      />
    </ScreenShell>
  );
}
