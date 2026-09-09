import Link from "next/link";
import { NewSystemForm } from "@/components/new-system-form";
import { ScreenShell } from "@/components/screen-shell";
import {
  nextStep,
  readyForTraining,
  setupProgress,
  setupSteps,
} from "@/lib/domain/setup-sequence";
import { getSystemBundle, listScreenshots, listSystems } from "@/lib/store/kb";

/**
 * The designer's home: every simulated system the app holds.
 *
 * Systems are independent. Each one owns how it behaves, what its console looks
 * like and which scenarios were taught inside it, so a second system can be
 * started before the first is finished, and neither affects the other.
 *
 * The page is ordered the way the work is. It used to open with the two links
 * that are about *everything* — the exercise library and the general knowledge
 * base — and close, below the fold, with the form for adding a system. So the
 * first thing a new designer saw was two places they had no reason to go, and
 * the one thing they had to do first was the last thing on the page. Now the
 * systems lead, each one saying which step it is waiting on, and the
 * everything-else links sit at the foot where you go looking for them.
 */

export const dynamic = "force-dynamic";

export default async function DesignerHome() {
  const systems = await listSystems();
  const bundles = await Promise.all(
    systems.map(async (system) => {
      // The bundle re-reads the system record; the one from the listing is
      // already known to exist, so keep that and take only the rest.
      const [{ profile, gui, scenarios }, screenshots] = await Promise.all([
        getSystemBundle(system.id),
        listScreenshots(system.id),
      ]);
      /* The same five steps the system's own page draws, from the same
         function — so "next" here and "Do this next" there are the same
         step, always. */
      const steps = setupSteps({
        systemId: system.id,
        screenshotCount: screenshots.length,
        profile,
        gui,
        scenarios,
      });
      return {
        system,
        ready: readyForTraining(profile, scenarios),
        next: nextStep(steps),
        progress: setupProgress(steps),
      };
    }),
  );

  return (
    <ScreenShell
      theme="work"
      eyebrow="System Designer"
      title="Simulated systems"
      subtitle="Each system has its own behaviour, console and scenarios"
      /* Adding a system is the one thing that has to happen before anything
         else on this screen means anything, so it is reachable without
         scrolling past everything it comes before. */
      actions={
        systems.length > 0 ? (
          <Link href="#add-a-system" className="btn">
            Add a system
          </Link>
        ) : null
      }
    >
      {/* ---- The systems themselves --------------------------------- */}
      <section>
        <div className="mb-5">
          <h2 className="section-title">
            Your systems
            {bundles.length > 0 ? (
              <span className="ml-2 text-sm font-normal text-muted">
                {bundles.length}
              </span>
            ) : null}
          </h2>
          <p className="section-note">
            Each one is independent — its own behaviour, console and scenarios.
            Open one to carry on setting it up.
          </p>
        </div>

        {bundles.length === 0 ? (
          <div className="panel p-8 text-center">
            <p className="text-sm">No systems yet.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              A system is everything a trainee sees: how it behaves, what its
              console shows, and the scenarios its operators face. Name one
              below to begin — you can add more later, and they stay
              independent.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {bundles.map(({ system, ready, next, progress }) => (
              <li key={system.id}>
                <Link
                  href={`/designer/systems/${system.id}`}
                  className="panel card-link block p-5"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="text-lg font-semibold">{system.name}</h2>
                    <span className={`chip ${ready ? "status-ok" : "status-warn"}`}>
                      {ready ? "ready for training" : "in setup"}
                    </span>
                    <span className="data ml-auto text-xs text-muted">
                      {progress.complete} of {progress.total} steps
                    </span>
                  </div>

                  {system.note ? (
                    <p className="mt-1 text-sm text-muted">{system.note}</p>
                  ) : null}

                  {/* The whole point of the row. A designer coming back after
                      a week wants one sentence — this is it — and the three
                      neutral state chips that used to sit here made them work
                      it out from the parts instead. */}
                  <p className="mt-3 text-sm">
                    {progress.complete < progress.total && next ? (
                      <>
                        <span className="text-muted">Next: </span>
                        <span className="font-semibold text-accent">
                          {next.title}
                        </span>
                      </>
                    ) : (
                      /* Every step that can be finished is finished. Flying it
                         yourself never completes, so offering it as "next"
                         here would leave a fully built system permanently
                         reading as unfinished. */
                      <span className="text-ok">
                        Set up — nothing outstanding.
                      </span>
                    )}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Adding one --------------------------------------------- */}
      <section
        id="add-a-system"
        className="mt-12 scroll-mt-6 border-t border-line pt-8"
      >
        <h2 className="section-title">Add a system</h2>
        <p className="section-note mb-4">
          The name is the fictional one operators will see on the console and
          the one a trainee picks from. Keep it vendor-neutral.
        </p>
        <NewSystemForm />
      </section>

      {/* ---- Everything that is not about one system ---------------- */}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="section-title">Across every system</h2>
        <p className="section-note mb-4">
          Neither of these belongs to a single system, so neither is a step in
          setting one up.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/designer/exercises" className="panel card-link p-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-base font-semibold">Exercises</h3>
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
              <h3 className="text-base font-semibold">General knowledge</h3>
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
      </section>
    </ScreenShell>
  );
}
