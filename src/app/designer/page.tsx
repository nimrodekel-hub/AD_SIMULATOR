import Link from "next/link";
import { NewSystemForm } from "@/components/new-system-form";
import { ScreenShell } from "@/components/screen-shell";
import { getSystemBundle, listSystems } from "@/lib/store/kb";

/**
 * The designer's home: every simulated system the app holds.
 *
 * Systems are independent. Each one owns how it behaves, what its console looks
 * like and which scenarios were taught inside it, so a second system can be
 * started before the first is finished, and neither affects the other.
 */

export const dynamic = "force-dynamic";

export default async function DesignerHome() {
  const systems = await listSystems();
  const bundles = await Promise.all(
    systems.map(async (system) => {
      // The bundle re-reads the system record; the one from the listing is
      // already known to exist, so keep that and take only the rest.
      const { profile, gui, scenarios } = await getSystemBundle(system.id);
      return { system, profile, gui, scenarios };
    }),
  );

  return (
    <ScreenShell
      theme="work"
      eyebrow="System Designer"
      title="Simulated systems"
      subtitle="Each system has its own behaviour, console and scenarios"
    >
      {/* The library of exercises. Placed beside general knowledge because
          both are about everything rather than about one system, and because
          what trainees are actually being given was invisible until it had a
          front door. */}
      <Link
        href="/designer/exercises"
        className="panel mb-6 block p-5 transition-colors hover:border-accent"
      >
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-base font-semibold">Exercises</h2>
          <span className="chip">every engagement laid out so far</span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Every engagement the generator has produced, across every system —
          what each one puts in the air, what the trainee is told, and what
          counts as success. If one is no good, say what is wrong with it in
          your own words and it is laid out again.
        </p>
      </Link>

      {/* The layer above every system. Placed near the top because it is the
          thing to get right before teaching anything, and because it is easy
          to forget it exists once systems fill the page. */}
      <Link
        href="/designer/knowledge"
        className="panel mb-6 block p-5 transition-colors hover:border-accent"
      >
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-base font-semibold">General knowledge</h2>
          <span className="chip status-ok">before any system</span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          How air defence works in general, and the lessons that hold across
          systems. Every interview is told this before your system is
          discussed, so it asks about what only you can answer instead of the
          basics. Yours to edit.
        </p>
      </Link>

      {bundles.length === 0 ? (
        <div className="panel p-8 text-center">
          <p className="text-sm">No systems yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            A system is everything a trainee sees: how it behaves, what its
            console shows, and the scenarios its operators face. Name one to
            begin — you can add more later, and they stay independent.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {bundles.map(({ system, profile, gui, scenarios }) => {
            const approved = scenarios.filter(
              (entry) => entry.status === "approved",
            ).length;

            return (
              <li key={system.id}>
                <Link
                  href={`/designer/systems/${system.id}`}
                  className="panel block p-5 transition-colors hover:border-accent"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="text-lg font-semibold">{system.name}</h2>
                    <span
                      className={`chip ${
                        readyForTraining(profile?.approved, approved)
                          ? "status-ok"
                          : "status-warn"
                      }`}
                    >
                      {readyForTraining(profile?.approved, approved)
                        ? "ready for training"
                        : "in setup"}
                    </span>
                  </div>

                  {system.note ? (
                    <p className="mt-1 text-sm text-muted">{system.note}</p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Step
                      label="Behaviour"
                      done={profile?.approved === true}
                      state={
                        profile?.approved
                          ? "approved"
                          : profile
                            ? "draft"
                            : "not described"
                      }
                    />
                    <Step
                      label="Console"
                      done={gui?.approved === true}
                      state={
                        gui?.approved ? "approved" : gui ? "draft" : "not built"
                      }
                    />
                    <Step
                      label="Scenarios"
                      done={approved > 0}
                      state={
                        scenarios.length === 0
                          ? "none"
                          : `${approved} approved`
                      }
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="text-sm font-semibold">Add a system</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          The name is the fictional one operators will see on the console and
          the one a trainee picks from. Keep it vendor-neutral.
        </p>
        <NewSystemForm />
      </section>
    </ScreenShell>
  );
}

/** A system is trainable once it has a profile in force and something to teach. */
function readyForTraining(profileApproved: boolean | undefined, approved: number) {
  return profileApproved === true && approved > 0;
}

function Step({
  label,
  state,
  done,
}: {
  label: string;
  state: string;
  done: boolean;
}) {
  return (
    <span className="chip bg-panel-raised text-muted">
      <span className={done ? "text-ok" : "text-warn"}>{done ? "✓" : "•"}</span>
      <span className="ml-1.5">
        {label}: {state}
      </span>
    </span>
  );
}
