import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { SystemProfileForm } from "@/components/system-profile-form";
import { SYSTEM_QUESTIONS } from "@/lib/ai/tasks/learn-system";
import { getSystem, getSystemProfile } from "@/lib/store/kb";

/**
 * Setup step one: teaching the app how this system behaves.
 *
 * Comes before the console and before any dilemma on purpose. A dilemma is a
 * judgement call *within* a system; without knowing the system, the model
 * invents one — and every scenario after that is built on the invention.
 */

export const dynamic = "force-dynamic";

export default async function SystemProfilePage({
  params,
}: PageProps<"/designer/systems/[systemId]/profile">) {
  const { systemId } = await params;
  const [system, existing] = await Promise.all([
    getSystem(systemId),
    getSystemProfile(systemId),
  ]);
  if (!system) notFound();

  return (
    <ScreenShell
      theme="work"
      eyebrow={system.name}
      title="How the system behaves"
      subtitle="Taught once. Every scenario, console and debrief on this system is built from it."
    >
      <p className="mb-8">
        <Link
          href={`/designer/systems/${systemId}`}
          className="text-sm text-muted hover:text-accent"
        >
          ← {system.name}
        </Link>
      </p>

      <SystemProfileForm
        systemId={systemId}
        systemName={system.name}
        questions={SYSTEM_QUESTIONS}
        existing={existing}
      />
    </ScreenShell>
  );
}
