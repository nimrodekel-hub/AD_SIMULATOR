import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { getSystemBundle, listScreenshots } from "@/lib/store/kb";

/**
 * One system's setup sequence, then its knowledge base.
 *
 * The order matters and is shown as an order. A dilemma is a judgement call
 * *within* a system — teaching dilemmas before the system is described means
 * every scenario is generated against a system the model invented, and nothing
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
  const [{ system, profile, gui, dilemmas }, screenshots] = await Promise.all([
    getSystemBundle(systemId),
    listScreenshots(systemId),
  ]);
  if (!system) notFound();

  const referencesReady = screenshots.length > 0;
  const profileReady = profile?.approved === true;
  const consoleReady = gui?.approved === true;
  const base = `/designer/systems/${systemId}`;

  return (
    <ScreenShell
      theme="work"
      eyebrow="System Designer"
      title={system.name}
      subtitle={
        system.note || "Describe the system, build its console, then teach it dilemmas"
      }
    >
      <p className="mb-8">
        <Link href="/designer" className="text-sm text-muted hover:text-accent">
          ← All systems
        </Link>
      </p>

      {/* ---- Setup, in order ----------------------------------------- */}
      <section>
        <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted">
          Setup
        </h2>
        <ol className="mt-4 space-y-3">
          <SetupStep
            number={1}
            href={`${base}/screenshots`}
            title="Reference screenshots"
            done={referencesReady}
            state={
              referencesReady
                ? `${screenshots.length} stored`
                : "None uploaded"
            }
            blurb="Screenshots of the real console. They are read twice — once while your answers below are being interpreted, and again when the console is generated — so they come before the description, not after it."
          />
          <SetupStep
            number={2}
            href={`${base}/profile`}
            title="How the system behaves"
            done={profileReady}
            state={
              profileReady
                ? "In use"
                : profile
                  ? "Draft, not approved"
                  : "Not described"
            }
            blurb="Answer a set of questions about track classes, identification, the operator's actions and the engagement envelope. Everything downstream is built from it — without it the model invents a system, and the scenarios look right without being right."
            warnNote={
              referencesReady
                ? undefined
                : "You can answer without screenshots, but the questions about the display are much easier to get right when they are stored first."
            }
          />
          <SetupStep
            number={3}
            href={`${base}/gui`}
            title="Simulated console"
            done={consoleReady}
            blocked={!profileReady || !referencesReady}
            state={
              consoleReady ? "In use" : gui ? "Draft, not approved" : "Not built"
            }
            blurb="Generated from the stored screenshots and the behaviour profile together, so it shows the right columns and the right controls — not just the right colours."
            blockedNote={
              referencesReady
                ? "Needs the behaviour profile first."
                : "Needs the screenshots and the behaviour profile first."
            }
          />
          <SetupStep
            number={4}
            href={`${base}/learn`}
            title="Teach a dilemma"
            done={dilemmas.some((entry) => entry.status === "approved")}
            state={
              dilemmas.length === 0
                ? "None captured"
                : `${dilemmas.filter((d) => d.status === "approved").length} approved`
            }
            blurb="Talk a real operational dilemma through, review the record extracted from it, correct it, approve it."
            warnNote={
              profileReady
                ? undefined
                : "You can start now, but scenarios built from this dilemma will use an invented system until the profile is approved."
            }
          />
        </ol>
      </section>

      {/* ---- This system's dilemmas ---------------------------------- */}
      <section className="mt-12 border-t border-line pt-8">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-sm font-semibold">Dilemmas</h2>
          <Link href={`${base}/learn`} className="btn btn-primary">
            Teach a dilemma
          </Link>
        </div>

        {dilemmas.length === 0 ? (
          <div className="panel p-8 text-center">
            <p className="text-sm">Nothing captured yet.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted">
              Teaching a dilemma is a conversation: describe the situation the
              way you would to a new operator of {system.name}, and the system
              will extract a structured record for you to correct and approve.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {dilemmas.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`${base}/dilemmas/${entry.id}`}
                  className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-colors hover:border-accent"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{entry.title}</p>
                    <p className="data mt-1 truncate text-xs text-muted">
                      {entry.sub_domain_tag} · {entry.decision_points.length}{" "}
                      decision point
                      {entry.decision_points.length === 1 ? "" : "s"}
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

function SetupStep({
  number,
  href,
  title,
  blurb,
  state,
  done,
  blocked,
  blockedNote,
  warnNote,
}: {
  number: number;
  href: string;
  title: string;
  blurb: string;
  state: string;
  done: boolean;
  blocked?: boolean;
  blockedNote?: string;
  warnNote?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="panel flex gap-4 p-4 transition-colors hover:border-accent"
      >
        <span
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            done ? "status-ok" : "bg-panel-raised text-muted"
          }`}
        >
          {done ? "✓" : number}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-medium">{title}</p>
            <span className={`chip ${done ? "status-ok" : "status-warn"}`}>
              {state}
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{blurb}</p>

          {blocked && blockedNote ? (
            <p className="mt-2 text-xs text-warn">{blockedNote}</p>
          ) : null}
          {warnNote ? (
            <p className="mt-2 text-xs text-warn">{warnNote}</p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
