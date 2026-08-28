import { ScreenShell } from "@/components/screen-shell";
import { SystemProfileForm } from "@/components/system-profile-form";
import { SYSTEM_QUESTIONS } from "@/lib/ai/tasks/learn-system";
import { getSystemProfile } from "@/lib/store/kb";

/**
 * Setup step two: teaching the system how the system behaves.
 *
 * Comes before any dilemma on purpose. A dilemma is a judgement call *within* a
 * system; without knowing the system, the model invents one — and every
 * scenario after that is built on the invention.
 */

export const dynamic = "force-dynamic";

export default async function SystemProfilePage() {
  const existing = await getSystemProfile();

  return (
    <ScreenShell
      theme="work"
      eyebrow="System Designer"
      title="How the system behaves"
      subtitle="Taught once. Every scenario, console and debrief is built from it."
    >
      <SystemProfileForm questions={SYSTEM_QUESTIONS} existing={existing} />
    </ScreenShell>
  );
}
