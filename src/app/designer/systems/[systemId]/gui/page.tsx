import Link from "next/link";
import { notFound } from "next/navigation";
import { GuiBuilder } from "@/components/gui-builder";
import { ScreenShell } from "@/components/screen-shell";
import { asReported, readGuiJob } from "@/lib/store/gui-job";
import {
  getGuiTemplate,
  getSystem,
  getSystemProfile,
  listScreenshots,
} from "@/lib/store/kb";

export const dynamic = "force-dynamic";

export default async function GuiBuilderPage({
  params,
}: PageProps<"/designer/systems/[systemId]/gui">) {
  const { systemId } = await params;
  const [system, existing, profile, screenshots, job] = await Promise.all([
    getSystem(systemId),
    getGuiTemplate(systemId),
    getSystemProfile(systemId),
    listScreenshots(systemId),
    readGuiJob(systemId),
  ]);
  if (!system) notFound();

  // The route refuses to generate without both of these. Deciding it here as
  // well means the refusal arrives before the work rather than after it.
  const missing = !profile?.approved
    ? ("profile" as const)
    : screenshots.length === 0
      ? ("screenshots" as const)
      : null;

  return (
    <ScreenShell
      theme="work"
      eyebrow={system.name}
      title="Simulated console"
      subtitle="Built once from the stored references and the behaviour profile, then used by every run"
    >
      <p className="mb-8">
        <Link
          href={`/designer/systems/${systemId}`}
          className="text-sm text-muted hover:text-accent"
        >
          ← {system.name}
        </Link>
      </p>

      {/* A console built before the simulator has nowhere to put a radar
          picture, so runs fall back to the built-in layout rather than
          squeezing a scope into a panel meant for rows of text. Say so here,
          where it can be fixed, rather than leaving the designer to wonder why
          their console never appears. */}
      {existing?.approved &&
      !existing.generated_ui_code.includes('data-slot="scope"') ? (
        <div className="panel mb-8 border-l-2 border-l-warn p-4">
          <p className="text-sm">
            <strong>This console predates the live simulator.</strong> It has no
            place for a radar picture, so training runs are using the built-in
            operations layout instead of your console.
          </p>
          <p className="mt-2 text-xs text-muted">
            Rebuilding it from the same screenshots adds a scope panel — the
            circular display tracks actually move on — and runs will use your
            console again.
          </p>
        </div>
      ) : null}

      {missing === null ? (
        <GuiBuilder
          systemId={systemId}
          systemName={system.name}
          screenshotCount={screenshots.length}
          existing={existing}
          // Whatever was already under way. Loading this page mid-generation
          // picks the wait back up rather than starting again.
          initialJob={asReported(job)}
        />
      ) : (
        <div className="panel p-6">
          <span className="chip status-warn !normal-case">
            {missing === "screenshots"
              ? `${system.name} has no reference screenshots stored.`
              : profile
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

          <Link
            href={
              missing === "screenshots"
                ? `/designer/systems/${systemId}/screenshots`
                : `/designer/systems/${systemId}/profile`
            }
            className="btn btn-primary mt-5"
          >
            {missing === "screenshots"
              ? "Upload the screenshots first"
              : profile
                ? "Review and approve the profile"
                : "Describe the system first"}
          </Link>
        </div>
      )}
    </ScreenShell>
  );
}
