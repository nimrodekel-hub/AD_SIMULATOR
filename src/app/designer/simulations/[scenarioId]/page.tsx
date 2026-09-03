import Link from "next/link";
import { notFound } from "next/navigation";
import { ScenarioWorkbench } from "@/components/scenario-workbench";
import { ScreenShell } from "@/components/screen-shell";
import { getDilemma, getSystem, getSystemProfile } from "@/lib/store/kb";
import { asReported, readReviseJob } from "@/lib/store/scenario-revise-job";
import { getSavedScenario } from "@/lib/store/scenarios";

/**
 * One exercise, and the means to correct it.
 *
 * The system id travels in the query string because a scenario is filed under
 * its system — the same reason a dilemma is. It could be found by scanning
 * every system's library instead, but the listing already knows which one it
 * is, and a lookup that reads every directory to answer a question the caller
 * could have answered gets slower with every system added.
 */

export const dynamic = "force-dynamic";

export default async function ScenarioPage({
  params,
  searchParams,
}: PageProps<"/designer/simulations/[scenarioId]">) {
  const { scenarioId } = await params;
  const query = await searchParams;
  const systemId = typeof query.system === "string" ? query.system : "";

  const saved = systemId ? await getSavedScenario(systemId, scenarioId) : null;
  if (!saved) notFound();

  const [system, dilemma, profile, job] = await Promise.all([
    getSystem(saved.system_id),
    getDilemma(saved.system_id, saved.dilemma_entry_id),
    getSystemProfile(saved.system_id),
    readReviseJob(scenarioId),
  ]);

  return (
    <ScreenShell
      theme="work"
      eyebrow={`${system?.name ?? "a deleted system"} · exercise`}
      title={saved.scenario_instance.scenario_name || "Untitled exercise"}
      subtitle={
        dilemma
          ? `Teaches: ${dilemma.title}`
          : "The dilemma this taught is no longer in the knowledge base, so it cannot be laid out again."
      }
    >
      <p className="mb-8">
        <Link
          href="/designer/simulations"
          className="text-xs text-muted hover:text-accent"
        >
          ← Back to the exercises
        </Link>
      </p>

      <ScenarioWorkbench
        saved={saved}
        canRevise={dilemma !== null}
        profileApproved={profile?.approved === true}
        initialJob={asReported(job)}
      />
    </ScreenShell>
  );
}
