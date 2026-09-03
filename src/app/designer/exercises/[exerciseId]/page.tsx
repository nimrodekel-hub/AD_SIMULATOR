import Link from "next/link";
import { notFound } from "next/navigation";
import { ExerciseWorkbench } from "@/components/exercise-workbench";
import { ScreenShell } from "@/components/screen-shell";
import { getScenario, getSystem, getSystemProfile } from "@/lib/store/kb";
import { asReported, readReviseJob } from "@/lib/store/exercise-revise-job";
import { getSavedExercise } from "@/lib/store/exercises";

/**
 * One exercise, and the means to correct it.
 *
 * The system id travels in the query string because an exercise is filed under
 * its system — the same reason a scenario is. It could be found by scanning
 * every system's library instead, but the listing already knows which one it
 * is, and a lookup that reads every directory to answer a question the caller
 * could have answered gets slower with every system added.
 */

export const dynamic = "force-dynamic";

export default async function ExercisePage({
  params,
  searchParams,
}: PageProps<"/designer/exercises/[exerciseId]">) {
  const { exerciseId } = await params;
  const query = await searchParams;
  const systemId = typeof query.system === "string" ? query.system : "";

  const saved = systemId ? await getSavedExercise(systemId, exerciseId) : null;
  if (!saved) notFound();

  const [system, scenario, profile, job] = await Promise.all([
    getSystem(saved.system_id),
    getScenario(saved.system_id, saved.scenario_entry_id),
    getSystemProfile(saved.system_id),
    readReviseJob(exerciseId),
  ]);

  return (
    <ScreenShell
      theme="work"
      eyebrow={`${system?.name ?? "a deleted system"} · exercise`}
      title={saved.exercise_instance.exercise_name || "Untitled exercise"}
      subtitle={
        scenario
          ? `Teaches: ${scenario.title}`
          : "The scenario this taught is no longer in the knowledge base, so it cannot be laid out again."
      }
    >
      <p className="mb-8">
        <Link
          href="/designer/exercises"
          className="text-xs text-muted hover:text-accent"
        >
          ← Back to the exercises
        </Link>
      </p>

      <ExerciseWorkbench
        saved={saved}
        canRevise={scenario !== null}
        profileApproved={profile?.approved === true}
        initialJob={asReported(job)}
      />
    </ScreenShell>
  );
}
