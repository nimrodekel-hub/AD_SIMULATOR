import Link from "next/link";
import { notFound } from "next/navigation";
import { LearningChat } from "@/components/learning-chat";
import { ScreenShell } from "@/components/screen-shell";
import { asReported, readDilemmaJob } from "@/lib/store/dilemma-job";
import { getSystem } from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function LearnDilemmaPage({
  params,
}: PageProps<"/designer/systems/[systemId]/learn">) {
  const { systemId } = await params;
  const [system, job] = await Promise.all([
    getSystem(systemId),
    readDilemmaJob(systemId),
  ]);
  if (!system) notFound();

  return (
    <ScreenShell
      theme="work"
      eyebrow={system.name}
      title="Teach a dilemma"
      subtitle="Talk it through; the system extracts the structured record"
    >
      <p className="mb-8">
        <Link
          href={`/designer/systems/${systemId}`}
          className="text-sm text-muted hover:text-accent"
        >
          ← {system.name}
        </Link>
      </p>

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
