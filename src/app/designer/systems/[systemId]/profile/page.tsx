import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { SystemProfileForm } from "@/components/system-profile-form";
import { SYSTEM_QUESTIONS } from "@/lib/ai/tasks/learn-system";
import { getSystem, getSystemProfile } from "@/lib/store/kb";
import { PlayIcon } from "@/components/icons";

/**
 * Setup step one: teaching the app how this system behaves.
 *
 * Comes before the console and before any scenario on purpose. A scenario is a
 * judgement call *within* a system; without knowing the system, the model
 * invents one — and every exercise after that is built on the invention.
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
      subtitle="Taught once. Every exercise, console and debrief on this system is built from it."
    >
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <Link
          href={`/designer/systems/${systemId}`}
          className="text-sm text-muted hover:text-accent"
        >
          ← {system.name}
        </Link>

        {/* The figures below are exactly the ones a form cannot check: a
            detection range that gives four seconds of warning is a valid
            number. Flying them is the check, so the way to it sits on this
            page rather than only in the sequence. */}
        {existing ? (
          <Link
            href={`/designer/systems/${systemId}/test`}
            className="btn ml-auto"
          >
            <PlayIcon className="text-sm" />
            Test these figures
          </Link>
        ) : null}
      </div>

      <SystemProfileForm
        systemId={systemId}
        systemName={system.name}
        questions={SYSTEM_QUESTIONS}
        existing={existing}
      />
    </ScreenShell>
  );
}
