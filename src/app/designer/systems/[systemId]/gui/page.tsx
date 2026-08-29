import Link from "next/link";
import { notFound } from "next/navigation";
import { GuiBuilder } from "@/components/gui-builder";
import { ScreenShell } from "@/components/screen-shell";
import { getGuiTemplate, getSystem } from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function GuiBuilderPage({
  params,
}: PageProps<"/designer/systems/[systemId]/gui">) {
  const { systemId } = await params;
  const [system, existing] = await Promise.all([
    getSystem(systemId),
    getGuiTemplate(systemId),
  ]);
  if (!system) notFound();

  return (
    <ScreenShell
      theme="work"
      eyebrow={system.name}
      title="Simulated console"
      subtitle="Built once from reference screenshots, then used by every run on this system"
    >
      <p className="mb-8">
        <Link
          href={`/designer/systems/${systemId}`}
          className="text-sm text-muted hover:text-accent"
        >
          ← {system.name}
        </Link>
      </p>

      <GuiBuilder
        systemId={systemId}
        systemName={system.name}
        existing={existing}
      />
    </ScreenShell>
  );
}
