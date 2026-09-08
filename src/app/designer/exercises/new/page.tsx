import {
  ExerciseBuildForm,
  type BuildTarget,
} from "@/components/exercise-build-form";
import { ScreenShell } from "@/components/screen-shell";
import { listApprovedScenarios, listSystems } from "@/lib/store/kb";

/**
 * Building an exercise on purpose.
 *
 * Every exercise in this app used to be a by-product: a trainee asked for a
 * run, the generator laid one out, and it existed inside that session. A
 * designer could take hold of one afterwards and correct it — so the person
 * who knows what ought to be trained could only edit somebody else's accident,
 * and there was no way at all to say "build me an exercise about this".
 *
 * The scenario and the system are picked rather than matched, because a
 * designer building deliberately already knows which doctrine they are
 * exercising; matching from free text is what the trainee's side is for.
 */

export const dynamic = "force-dynamic";

export default async function NewExercisePage() {
  const systems = await listSystems();

  /* Only approved scenarios. An exercise built on a draft would teach doctrine
     its own author has not finished writing, and the API refuses it anyway —
     so it is not offered here either. */
  const targets: BuildTarget[] = await Promise.all(
    systems.map(async (system) => ({
      id: system.id,
      name: system.name,
      scenarios: (await listApprovedScenarios(system.id)).map((entry) => ({
        id: entry.id,
        title: entry.title,
      })),
    })),
  );

  /* A system with nothing approved cannot be built against, and offering it
     only produces a form that refuses at the last step. */
  const buildable = targets.filter((entry) => entry.scenarios.length > 0);

  return (
    <ScreenShell
      theme="work"
      eyebrow="Designer"
      title="Build an exercise"
      subtitle="Say what it is for, and the engagement is laid out to deliver it"
      back={{ href: "/designer/exercises", label: "Exercises" }}
    >
      <ExerciseBuildForm targets={buildable} />
    </ScreenShell>
  );
}
