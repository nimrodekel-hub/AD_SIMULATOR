import Link from "next/link";
import { ScreenShell } from "@/components/screen-shell";
import { TrainingRequest } from "@/components/training-request";
import { getSystemBundle, listSystems } from "@/lib/store/kb";
import { listTrainees } from "@/lib/store/sessions";

/**
 * Where a trainee starts: pick the system, then say what to train on.
 *
 * The system comes first because a dilemma is only meaningful inside one. Its
 * identification states, its operator actions and its plausible numbers all
 * come from that system's profile, so matching a request against dilemmas from
 * a different system would teach a procedure the trainee's console does not
 * have.
 *
 * With exactly one system available the picker is skipped — there is no choice
 * to make, and a list of one is a needless step.
 */

export const dynamic = "force-dynamic";

export default async function TraineePage({
  searchParams,
}: PageProps<"/trainee">) {
  const [systems, trainees, query] = await Promise.all([
    listSystems(),
    listTrainees(),
    searchParams,
  ]);

  // An instructor can start a run for a specific trainee from their history
  // page. It pre-selects the console operator; it does not replace the
  // trainee's own ability to ask for training.
  const requestedTrainee =
    typeof query.trainee === "string" ? query.trainee : undefined;
  const preselected = trainees.some((trainee) => trainee.id === requestedTrainee)
    ? requestedTrainee
    : undefined;

  const requestedSystem =
    typeof query.system === "string" ? query.system : undefined;
  const chosen =
    systems.find((system) => system.id === requestedSystem) ??
    (systems.length === 1 ? systems[0] : undefined);

  /* ---- Nothing to train on yet --------------------------------- */
  if (systems.length === 0) {
    return (
      <ScreenShell
        theme="ops"
        eyebrow="Trainee"
        title="No systems yet"
        subtitle="There is nothing to train on"
      >
        <div className="panel p-6">
          <p className="text-sm">
            No simulated system has been set up. A system designer needs to
            create one, describe how it behaves and teach it at least one
            dilemma before training can start.
          </p>
          <Link href="/designer" className="btn btn-primary mt-4">
            Go to the designer
          </Link>
        </div>
      </ScreenShell>
    );
  }

  /* ---- Choose a system ----------------------------------------- */
  if (!chosen) {
    const bundles = await Promise.all(
      systems.map(async (system) => {
        const { profile, dilemmas } = await getSystemBundle(system.id);
        return {
          system,
          ready:
            profile?.approved === true &&
            dilemmas.some((entry) => entry.status === "approved"),
          approved: dilemmas.filter((entry) => entry.status === "approved").length,
        };
      }),
    );

    return (
      <ScreenShell
        theme="ops"
        eyebrow="Trainee"
        title="Choose a system"
        subtitle="Train on the system you operate"
      >
        <ul className="space-y-3">
          {bundles.map(({ system, ready, approved }) => (
            <li key={system.id}>
              <Link
                href={{
                  pathname: "/trainee",
                  query: preselected
                    ? { system: system.id, trainee: preselected }
                    : { system: system.id },
                }}
                className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-colors hover:border-accent"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{system.name}</p>
                  <p className="mt-1 text-xs text-muted">
                    {system.note ||
                      (ready
                        ? `${approved} dilemma${approved === 1 ? "" : "s"} to train on`
                        : "Still being set up")}
                  </p>
                </div>
                <span className={`chip ${ready ? "status-ok" : "status-warn"}`}>
                  {ready ? `${approved} available` : "not ready"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </ScreenShell>
    );
  }

  /* ---- Ask for it, or choose it ---------------------------------- */

  /* The approved drills for the chosen system, so the trainee can pick one
     instead of describing it. Only approved ones: a draft is the designer
     still working, and half-taught doctrine trains the wrong thing. */
  const { dilemmas } = await getSystemBundle(chosen.id);
  const catalogue = dilemmas
    .filter((entry) => entry.status === "approved")
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      tag: entry.sub_domain_tag,
      when: entry.trigger_conditions,
    }));

  return (
    <ScreenShell
      theme="ops"
      eyebrow={`Trainee · ${chosen.name}`}
      title="Request training"
      subtitle="Say what you want to practise, or pick a drill"
      contained={false}
    >
      {systems.length > 1 ? (
        <div className="px-6 pt-4">
          <Link
            href="/trainee"
            className="text-xs text-muted hover:text-accent"
          >
            ← Choose a different system
          </Link>
        </div>
      ) : null}

      <TrainingRequest
        systemId={chosen.id}
        systemName={chosen.name}
        trainees={trainees}
        catalogue={catalogue}
        preselectedTraineeId={preselected}
      />
    </ScreenShell>
  );
}
