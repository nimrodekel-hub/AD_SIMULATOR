import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { SetupSequence } from "@/components/setup-steps";
import { setupSteps } from "@/lib/domain/setup-sequence";
import { getSystemBundle, listScreenshots } from "@/lib/store/kb";
import { PlayIcon } from "@/components/icons";

/**
 * One system's setup sequence, then its knowledge base.
 *
 * The order matters and is shown as an order. A scenario is a judgement call
 * *within* a system — teaching scenarios before the system is described means
 * every exercise is generated against a system the model invented, and nothing
 * about the result looks wrong.
 *
 * The screenshots come first for the same kind of reason. The questions in step
 * 2 ask what the display shows — which columns, in what order, in what units.
 * Those answers are read far more accurately with the display itself in hand,
 * so the references are stored before the description rather than after it.
 */

export const dynamic = "force-dynamic";

export default async function SystemSetupPage({
  params,
}: PageProps<"/designer/systems/[systemId]">) {
  const { systemId } = await params;
  const [{ system, profile, gui, scenarios }, screenshots] = await Promise.all([
    getSystemBundle(systemId),
    listScreenshots(systemId),
  ]);
  if (!system) notFound();

  const base = `/designer/systems/${systemId}`;
  const steps = setupSteps({
    systemId,
    screenshotCount: screenshots.length,
    profile,
    gui,
    scenarios,
  });

  return (
    <ScreenShell
      theme="work"
      eyebrow="System designer"
      title={system.name}
      subtitle={
        system.note ||
        "Describe the system, build its console, then teach it scenarios"
      }
      back={{ href: "/designer", label: "All systems" }}
      actions={
        profile ? (
          <Link href={`${base}/test`} className="btn">
            <PlayIcon className="text-sm" />
            Fly it yourself
          </Link>
        ) : null
      }
    >
      <SetupSequence
        steps={steps}
        intro="Five steps, in this order. Each one is used by the ones after it."
      />

      {/* ---- This system's scenarios ---------------------------------- */}
      <section className="mt-12 border-t border-line pt-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <h2 className="section-title">Scenarios on this system</h2>
            <p className="section-note">
              What a trainee can be put through. Each holds the dilemmas you
              decided belong in it.
            </p>
          </div>
          <Link href={`${base}/learn`} className="btn btn-primary">
            Teach a scenario
          </Link>
        </div>

        {/* What the three words mean to each other. Written down because the
            distinction is the whole structure of the app and is invisible
            from any one screen: a designer looking at this list cannot tell
            from it that the dilemmas live inside these, or that what a
            trainee actually flies is generated from one of them later. */}
        <p className="mt-5 mb-5 max-w-2xl rounded-xl border border-line bg-panel/60 p-4 text-xs leading-relaxed text-muted">
          A <strong>scenario</strong> is a situation an operator can be put in,
          and it holds however many <strong>dilemmas</strong> — hard choices —
          you decide belong in it. An <strong>exercise</strong> is one concrete
          run of a scenario, laid out with real tracks and timings when a
          trainee asks for it; those collect in{" "}
          <Link href="/designer/exercises" className="hover:text-accent">
            Exercises
          </Link>
          .
        </p>

        {scenarios.length === 0 ? (
          <div className="panel p-8 text-center">
            <p className="text-sm">Nothing captured yet.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Teaching a scenario is a conversation: describe the situation the
              way you would to a new operator of {system.name}, and the system
              will extract a structured record for you to correct and approve.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {scenarios.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`${base}/scenarios/${entry.id}`}
                  className="panel card-link flex flex-wrap items-center gap-x-4 gap-y-2 p-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold">{entry.title}</p>
                    <p className="data mt-1 truncate text-xs text-muted">
                      {entry.sub_domain_tag} · {entry.dilemmas.length}{" "}
                      dilemma
                      {entry.dilemmas.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span
                    className={`chip ${
                      entry.status === "approved" ? "status-ok" : "status-warn"
                    }`}
                  >
                    {entry.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </ScreenShell>
  );
}
