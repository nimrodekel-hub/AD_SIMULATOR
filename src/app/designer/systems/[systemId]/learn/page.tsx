import { notFound } from "next/navigation";
import { LearningChat } from "@/components/learning-chat";
import { ScreenShell } from "@/components/screen-shell";
import { asReported, readScenarioJob } from "@/lib/store/scenario-job";
import { getSystem } from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function LearnScenarioPage({
  params,
}: PageProps<"/designer/systems/[systemId]/learn">) {
  const { systemId } = await params;
  const [system, job] = await Promise.all([
    getSystem(systemId),
    readScenarioJob(systemId),
  ]);
  if (!system) notFound();

  return (
    <ScreenShell
      theme="work"
      eyebrow={system.name}
      title="Teach a scenario"
      subtitle="Talk it through; the system extracts the structured record"
      back={{ href: `/designer/systems/${systemId}`, label: system.name }}
    >
      <LearningChat
        systemId={systemId}
        systemName={system.name}
        // Whatever extraction was already under way, or had already finished,
        // when this page loaded. Coming back to a locked phone lands here.
        initialJob={asReported(job)}
      />
    </ScreenShell>
  );
}
