import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { SetupSequence, type SetupStep } from "@/components/setup-steps";
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

  const referencesReady = screenshots.length > 0;
  const profileReady = profile?.approved === true;
  const consoleReady = gui?.approved === true;
  const approvedScenarios = scenarios.filter(
    (entry) => entry.status === "approved",
  ).length;
  const base = `/designer/systems/${systemId}`;

  const steps: SetupStep[] = [
    {
      title: "Store reference screenshots",
      href: `${base}/screenshots`,
      done: referencesReady,
      state: referencesReady ? `${screenshots.length} stored` : "None yet",
      blurb:
        "Screenshots of the real console. They are read twice — once while your answers below are interpreted, and again when the console is built — so they come first.",
    },
    {
      title: "Describe how it behaves",
      href: `${base}/profile`,
      done: profileReady,
      state: profileReady ? "Approved" : profile ? "Draft" : "Not started",
      blurb:
        "Track classes, identification, what the operator can do, the engagement envelope. Everything downstream is built from this — without it the model invents a system, and the exercises look right without being right.",
      note: referencesReady
        ? undefined
        : "The questions about the display are much easier to answer with the screenshots stored first.",
    },
    {
      title: "Build the simulated console",
      href: `${base}/gui`,
      done: consoleReady,
      blocked: !profileReady || !referencesReady,
      state: consoleReady ? "Approved" : gui ? "Draft" : "Not built",
      blurb:
        "Generated from the screenshots and the behaviour profile together, so it shows the right columns and the right controls — not just the right colours.",
      note:
        !profileReady || !referencesReady
          ? referencesReady
            ? "Waiting on the behaviour profile."
            : "Waiting on the screenshots and the behaviour profile."
          : undefined,
    },
    {
      title: "Fly it yourself",
      href: `${base}/test`,
      done: false,
      repeatable: true,
      blocked: profile === null,
      state:
        profile === null
          ? "Needs the profile"
          : consoleReady
            ? "On your console"
            : "Built-in layout",
      blurb:
        "Targets, real controls, the clock running. This is where you find out whether the detection range gives an operator any warning and whether your console holds up with a live picture in it. Nothing is recorded — run it as often as you like.",
      note:
        profile === null
          ? "Fill in the behaviour profile first — the test flies this system's own figures. A draft is enough."
          : undefined,
    },
    {
      title: "Teach it a scenario",
      href: `${base}/learn`,
      done: approvedScenarios > 0,
      state:
        scenarios.length === 0
          ? "None captured"
          : `${approvedScenarios} approved`,
      blurb:
        "Talk a real operational scenario through, review the record extracted from it, correct it, approve it.",
      note: profileReady
        ? undefined
        : "You can start now, but exercises built from this scenario will use an invented system until the profile is approved.",
    },
  ];

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
