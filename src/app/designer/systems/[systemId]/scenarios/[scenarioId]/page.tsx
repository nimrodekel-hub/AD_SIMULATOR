import Link from "next/link";
import { notFound } from "next/navigation";
import { ScenarioEditor } from "@/components/scenario-editor";
import { ScreenShell } from "@/components/screen-shell";
import { getScenario, getSystem } from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function ScenarioPage({
  params,
}: PageProps<"/designer/systems/[systemId]/scenarios/[scenarioId]">) {
  const { systemId, scenarioId } = await params;
  const [system, entry] = await Promise.all([
    getSystem(systemId),
    getScenario(systemId, scenarioId),
  ]);
  if (!system || !entry) notFound();

  return (
    <ScreenShell
      theme="work"
      eyebrow={system.name}
      title={entry.title}
      subtitle={entry.sub_domain_tag}
    >
      <p className="mb-8">
        <Link
          href={`/designer/systems/${systemId}`}
          className="text-sm text-muted hover:text-accent"
        >
          ← {system.name}
        </Link>
      </p>

      <ScenarioEditor systemId={systemId} entry={entry} />
    </ScreenShell>
  );
}
