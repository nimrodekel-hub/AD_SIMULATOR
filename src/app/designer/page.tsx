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
      {/* The two things that are about *everything* rather than about one
          system. Side by side and compact, because on the old page they were
          full-width cards above the list and read as two more systems — the
          first thing on the screen looked like the thing the screen is a list
          of. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/designer/exercises" className="panel card-link p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold">Exercises</h2>
            <span aria-hidden className="ml-auto text-muted">
              &rarr;
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Every engagement laid out so far, across every system — and where
            you build a new one from a brief.
          </p>
        </Link>

        <Link href="/designer/knowledge" className="panel card-link p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold">General knowledge</h2>
            <span aria-hidden className="ml-auto text-muted">
              &rarr;
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            How air defence works in general. Every interview is told this
            first, so it asks you about what only you can answer.
          </p>
        </Link>
      </div>

      {/* ---- The systems themselves --------------------------------- */}
      <section className="mt-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 className="section-title">
              Your systems
              {bundles.length > 0 ? (
                <span className="ml-2 text-sm font-normal text-muted">
                  {bundles.length}
                </span>
              ) : null}
            </h2>
            <p className="section-note">
              Each one is independent — its own behaviour, console and
              scenarios. Open one to carry on setting it up.
            </p>
          </div>
        </div>

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
                  className="panel card-link block p-5"
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

      </section>

      <section className="mt-12 border-t border-line pt-8">
        <h2 className="section-title">Add a system</h2>
        <p className="section-note mb-4">
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
