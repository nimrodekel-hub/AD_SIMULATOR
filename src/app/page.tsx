import Link from "next/link";
import { config, githubConfigProblems } from "@/lib/config";
import { getSystemBundle, listSystems } from "@/lib/store/kb";
import { isGitBacked } from "@/lib/store/repo-files";

/* Reads the knowledge base on every request — this page is a live status
   board, and a cached copy would misreport what the system holds. */
export const dynamic = "force-dynamic";

const ROLES = [
  {
    href: "/designer",
    name: "System Designer",
    blurb:
      "Set up a simulated system: describe how it behaves, build its console from screenshots, and teach it operational dilemmas through conversation. As many systems as you need, side by side.",
    responsibility: "Owns the knowledge base",
  },
  {
    href: "/instructor",
    name: "Instructor",
    blurb:
      "Follow trainees across sessions: scores, trend, and the full record of every decision and debrief.",
    responsibility: "Owns oversight",
  },
  {
    href: "/trainee",
    name: "Trainee",
    blurb:
      "Pick the system you operate, then ask for the training you want in your own words. It finds the matching dilemma and builds a scenario around it.",
    responsibility: "Runs the training",
  },
] as const;

export default async function Home() {
  const systems = await listSystems();
  const bundles = await Promise.all(
    systems.map((system) => getSystemBundle(system.id)),
  );

  const dilemmas = bundles.flatMap((bundle) => bundle.dilemmas);
  const approved = dilemmas.filter((entry) => entry.status === "approved").length;
  const drafts = dilemmas.length - approved;

  // A system is trainable only when its behaviour is in force and it has
  // something to teach. Counting systems without that would report readiness
  // the app does not have.
  const trainable = bundles.filter(
    (bundle) =>
      bundle.profile?.approved === true &&
      bundle.dilemmas.some((entry) => entry.status === "approved"),
  ).length;
  const consoles = bundles.filter((bundle) => bundle.gui?.approved === true).length;

  return (
    <div className="theme-work flex min-h-full flex-1 flex-col bg-bg text-ink">
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-accent">
          Proof of concept
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Air Defence Training Simulator
        </h1>
        <p className="prose-block mt-4 max-w-2xl text-muted">
          A generic operational trainer. A domain expert teaches the system real
          dilemmas by talking through them; trainees then ask for the practice
          they want in plain language, and the system builds a scenario from the
          captured expertise — then debriefs them against the expert&rsquo;s own
          reasoning.
        </p>

        <h2 className="mt-14 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted">
          Choose a role
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {ROLES.map((role) => (
            <Link
              key={role.href}
              href={role.href}
              className="panel group flex flex-col p-5 transition-colors hover:border-accent"
            >
              <p className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted">
                {role.responsibility}
              </p>
              <h3 className="mt-2 text-lg font-semibold transition-colors group-hover:text-accent">
                {role.name}
              </h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">
                {role.blurb}
              </p>
            </Link>
          ))}
        </div>

        <h2 className="mt-14 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted">
          System status
        </h2>
        <dl className="panel mt-4 divide-y divide-[var(--border)]">
          <StatusRow
            label="Simulated systems"
            value={
              systems.length === 0
                ? "None"
                : `${systems.length} — ${trainable} ready for training`
            }
            tone={trainable > 0 ? "ok" : "warn"}
            note={
              systems.length === 0
                ? "Nothing has been set up yet. A system is where everything else hangs."
                : trainable === 0
                  ? "A system is ready once its behaviour profile is approved and it has an approved dilemma."
                  : systems
                      .map((system) => system.name)
                      .join(", ")
            }
          />
          <StatusRow
            label="Knowledge base"
            value={`${approved} approved${drafts > 0 ? `, ${drafts} draft` : ""}`}
            tone={approved > 0 ? "ok" : "warn"}
            note={
              approved === 0
                ? "No approved dilemmas yet — trainees have nothing to match against."
                : "Counted across every system. A dilemma only ever matches within its own."
            }
          />
          <StatusRow
            label="Simulated consoles"
            value={
              consoles === 0 ? "None built" : `${consoles} of ${systems.length}`
            }
            tone={consoles > 0 ? "ok" : "warn"}
            note={
              consoles === systems.length && systems.length > 0
                ? undefined
                : "A system without an approved console falls back to the plain text one."
            }
          />
          <StatusRow
            label="Storage"
            value={isGitBacked() ? "Git — committed to the repository" : "Local filesystem"}
            tone={isGitBacked() ? "ok" : "danger"}
            note={
              isGitBacked()
                ? "Dilemmas and training runs alike are committed as files."
                : `Nothing you save will survive. ${githubConfigProblems().join("; ")}. Fix in Vercel under Settings → Environment Variables, then redeploy — environment changes only take effect on a new build.`
            }
          />
          <StatusRow
            label="AI engine"
            value={config.anthropic.mock ? "Mock — no API key" : config.anthropic.model}
            tone={config.anthropic.mock ? "danger" : "ok"}
            note={
              config.anthropic.mock
                ? "ANTHROPIC_API_KEY is not set. Screens are clickable but every AI response is canned."
                : undefined
            }
          />
        </dl>
      </main>
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "danger";
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3.5">
      <dt className="w-44 shrink-0 text-sm text-muted">{label}</dt>
      <dd className="flex flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`chip status-${tone}`}>{value}</span>
        {note ? <span className="text-xs text-muted">{note}</span> : null}
      </dd>
    </div>
  );
}
