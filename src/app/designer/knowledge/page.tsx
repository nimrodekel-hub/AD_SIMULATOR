import Link from "next/link";
import { KnowledgeEditor } from "@/components/knowledge-editor";
import { ScreenShell } from "@/components/screen-shell";
import { getGeneralKnowledge } from "@/lib/store/general-knowledge";

export const dynamic = "force-dynamic";

export default async function GeneralKnowledgePage() {
  const knowledge = await getGeneralKnowledge();

  return (
    <ScreenShell
      theme="work"
      eyebrow="Before any system"
      title="General knowledge"
      subtitle="What holds across every air-defence system, and the lessons that keep proving true"
    >
      <p className="mb-8">
        <Link href="/designer" className="text-sm text-muted hover:text-accent">
          ← System designer
        </Link>
      </p>

      <KnowledgeEditor initial={knowledge} />
    </ScreenShell>
  );
}
