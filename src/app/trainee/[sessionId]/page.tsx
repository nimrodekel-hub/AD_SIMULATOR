import { notFound, redirect } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { ScenarioRun } from "@/components/scenario-run";
import { getSession } from "@/lib/store/sessions";

export const dynamic = "force-dynamic";

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

  return (
    <ScreenShell
      theme="ops"
      eyebrow="Trainee · Live run"
      title={session.scenario_instance.scenario_name}
      contained={false}
    >
      <ScenarioRun session={session} />
    </ScreenShell>
  );
}
