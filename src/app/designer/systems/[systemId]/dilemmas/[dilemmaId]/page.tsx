import Link from "next/link";
import { notFound } from "next/navigation";
import { DilemmaEditor } from "@/components/dilemma-editor";
import { ScreenShell } from "@/components/screen-shell";
import { getDilemma, getSystem } from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function DilemmaPage({
  params,
}: PageProps<"/designer/systems/[systemId]/dilemmas/[dilemmaId]">) {
  const { systemId, dilemmaId } = await params;
  const [system, entry] = await Promise.all([
    getSystem(systemId),
    getDilemma(systemId, dilemmaId),
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

      <DilemmaEditor systemId={systemId} entry={entry} />
    </ScreenShell>
  );
}
