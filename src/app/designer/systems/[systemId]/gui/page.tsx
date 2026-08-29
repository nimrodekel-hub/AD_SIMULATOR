import Link from "next/link";
import { notFound } from "next/navigation";
import { GuiBuilder } from "@/components/gui-builder";
import { ScreenShell } from "@/components/screen-shell";
import { getGuiTemplate, getSystem, getSystemProfile } from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function GuiBuilderPage({
  params,
}: PageProps<"/designer/systems/[systemId]/gui">) {
  const { systemId } = await params;
  const [system, existing, profile] = await Promise.all([
    getSystem(systemId),
    getGuiTemplate(systemId),
    getSystemProfile(systemId),
  ]);
  if (!system) notFound();

  // The route refuses to generate without an approved profile. Deciding that
  // here as well means the refusal arrives before the work, not after a
  // selection has been made and an upload has been waited on.
  const profileReady = profile?.approved === true;

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

      {profileReady ? (
        <GuiBuilder
          systemId={systemId}
          systemName={system.name}
          existing={existing}
        />
      ) : (
        <div className="panel p-6">
          <span className="chip status-warn !normal-case">
            {profile
              ? "The behaviour profile is saved but not approved yet."
              : `${system.name} has not been described yet.`}
          </span>

          <p className="prose-block mt-4 max-w-2xl text-sm">
            The console is generated from the screenshots <em>and</em> the
            behaviour profile together. The screenshots give it a look; the
            profile decides which columns appear and in what order, what each
            identification colour means, and which controls the operator gets.
            Built from screenshots alone it would look right and behave wrong —
            the one failure nobody notices.
          </p>

          <p className="mt-3 max-w-2xl text-sm text-muted">
            It is eight questions and takes a few minutes. Anything left blank
            is filled in from the rest, and you correct it before approving.
          </p>

          <Link
            href={`/designer/systems/${systemId}/profile`}
            className="btn btn-primary mt-5"
          >
            {profile ? "Review and approve the profile" : "Describe the system first"}
          </Link>
        </div>
      )}
    </ScreenShell>
  );
}
