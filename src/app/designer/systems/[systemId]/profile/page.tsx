import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { SystemChangeRequest } from "@/components/system-change-request";
import { SystemProfileForm } from "@/components/system-profile-form";
import { SYSTEM_QUESTIONS } from "@/lib/ai/tasks/learn-system";
import { getGuiTemplate, getSystem, getSystemProfile } from "@/lib/store/kb";
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
  const [system, existing, gui] = await Promise.all([
    getSystem(systemId),
    getSystemProfile(systemId),
    getGuiTemplate(systemId),
  ]);
  if (!system) notFound();

  return (
    <ScreenShell
      theme="work"
      eyebrow={system.name}
      title="How the system behaves"
      subtitle="Taught once. Every exercise, console and debrief on this system is built from it."
      back={{ href: `/designer/systems/${systemId}`, label: system.name }}
      /* The figures below are exactly the ones a form cannot check: a
         detection range that gives four seconds of warning is a valid number.
         Flying them is the check, so the way to it sits on this page rather
         than only in the sequence. */
      actions={
        existing ? (
          <Link href={`/designer/systems/${systemId}/test`} className="btn">
            <PlayIcon className="text-sm" />
            Test these figures
          </Link>
        ) : null
      }
    >
      {/* One change in words instead of finding the field in ten sections.
          Only once there is a profile: before that, the questions below are
          how it gets written in the first place. */}
      {existing ? (
        <div className="mb-10">
          <SystemChangeRequest systemId={systemId} hasConsole={!!gui} />
        </div>
      ) : null}

      <SystemProfileForm
        /* Rebuilt from the stored profile whenever that changes. The form
           keeps its own copy while it is being edited, and a change made by
           asking — saved and refreshed under it — would otherwise sit behind a
           form still holding the old values, one Save away from being
           overwritten. */
        key={versionOf(existing)}
        systemId={systemId}
        systemName={system.name}
        questions={SYSTEM_QUESTIONS}
        existing={existing}
      />
    </ScreenShell>
  );
}

/** A short fingerprint of the stored profile, for keying the form on it. */
function versionOf(profile: unknown): string {
  const text = JSON.stringify(profile ?? null);
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return String(hash);
}
