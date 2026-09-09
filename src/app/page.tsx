import { JourneyStages, type Stage } from "@/components/journey-stages";
import { config, githubConfigProblems } from "@/lib/config";
import { getSystemBundle, listSystems } from "@/lib/store/kb";
import { githubWriteAccess, isGitBacked } from "@/lib/store/repo-files";
import { listAllSessions } from "@/lib/store/sessions";

/* Reads the knowledge base on every request — this page is a live status
   board, and a cached copy would misreport what the system holds. */
export const dynamic = "force-dynamic";

export default async function Home() {
  const systems = await listSystems();
  const [bundles, sessions, storage] = await Promise.all([
    Promise.all(systems.map((system) => getSystemBundle(system.id))),
    listAllSessions(),
    // Asks GitHub whether the token can actually write, rather than trusting
    // that the variables being set means saving works.
    isGitBacked() ? githubWriteAccess() : Promise.resolve(null),
  ]);

  const scenarios = bundles.flatMap((bundle) => bundle.scenarios);
  const approved = scenarios.filter((entry) => entry.status === "approved").length;
  const drafts = scenarios.length - approved;

  // A system is trainable only when its behaviour is in force and it has
  // something to teach. Counting systems without that would report readiness
  // the app does not have.
  const trainable = bundles.filter(
    (bundle) =>
      bundle.profile?.approved === true &&
      bundle.scenarios.some((entry) => entry.status === "approved"),
  ).length;
  const consoles = bundles.filter((bundle) => bundle.gui?.approved === true).length;
  const flown = sessions.filter((entry) => entry.status === "completed").length;

  /* The three roles were laid out side by side as equals, and they are not.
     Nothing can be trained until a system is set up, and nothing can be
     reviewed until something has been flown — so a first-time visitor who
     picked the middle card arrived at a screen that could only turn them
     away. Drawn as the sequence it actually is, with each stage saying what
     it is waiting for, the order stops being something to discover. */
  const journey: Stage[] = [
    {
      title: "Set up a system to train on",
      href: "/designer",
      begun: trainable > 0,
      state:
        systems.length === 0
          ? "Nothing yet"
          : trainable > 0
            ? `${trainable} ready`
            : `${systems.length} in setup`,
      blurb:
        "Describe how a system behaves, build its console from screenshots of the real one, and teach it operational scenarios by talking them through. As many systems as you need, side by side.",
    },
    {
      title: "Put a trainee through it",
      href: "/trainee",
      begun: sessions.length > 0,
      blocked: trainable === 0,
      state:
        sessions.length === 0
          ? "No runs yet"
          : `${sessions.length} run${sessions.length === 1 ? "" : "s"}`,
      blurb:
        "The trainee picks a system and asks for the practice they want in their own words. A matching scenario is found and an exercise built around it, then flown on the console.",
      note:
        trainable === 0
          ? systems.length === 0
            ? "Waiting on a system. Start at stage 1."
            : "A system is ready once its behaviour profile is approved and it has at least one approved scenario."
          : undefined,
    },
    {
      title: "Review how they did",
      href: "/instructor",
      begun: flown > 0,
      blocked: sessions.length === 0,
      state: flown === 0 ? "Nothing to review" : `${flown} debriefed`,
      blurb:
        "Every run a trainee has flown: the score, the trend across sessions, and the full record of each decision alongside the debrief written against the expert's own reasoning.",
      note: sessions.length === 0 ? "Waiting on a completed run." : undefined,
    },
  ];

  return (
    <div className="theme-work flex min-h-full flex-1 flex-col bg-bg text-ink">
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-20">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-accent">
          Proof of concept
        </p>
        <h1 className="mt-4 max-w-3xl text-[2.75rem] font-semibold leading-[1.08] tracking-[-0.03em]">
          Air Defence Training Simulator
        </h1>
        <p className="prose-block mt-5 max-w-2xl text-lg text-muted">
          A generic operational trainer. A domain expert teaches the system real
          scenarios by talking through them; trainees then ask for the practice
          they want in plain language, and the system builds an exercise from the
          captured expertise — then debriefs them against the expert&rsquo;s own
          reasoning.
        </p>

        <h2 className="section-title mt-16">How this works</h2>
        <p className="section-note">
          Three stages, in order — each one needs the one before it. Open any of
          them to pick up where you left off.
        </p>
        <div className="mt-5">
          <JourneyStages stages={journey} />
        </div>

        <h2 className="section-title mt-16">What the system holds right now</h2>
        <p className="section-note">
          Read live on every visit, so it never reports a state the app is not in.
        </p>
        <dl className="panel mt-5 divide-y divide-[var(--border)]">
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
                  ? "A system is ready once its behaviour profile is approved and it has an approved scenario."
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
                ? "No approved scenarios yet — trainees have nothing to match against."
                : "Counted across every system. A scenario only ever matches within its own."
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
            value={
              !isGitBacked()
                ? "Local filesystem"
                : storage?.ok
                  ? "Git — committed to the repository"
                  : "Git — cannot write"
            }
            tone={storage?.ok ? "ok" : "danger"}
            note={
              !isGitBacked()
                ? `Nothing you save will survive. ${githubConfigProblems().join("; ")}. Fix in Vercel under Settings → Environment Variables, then redeploy — environment changes only take effect on a new build.`
                : storage?.ok
                  ? "Scenarios and training runs alike are committed as files."
                  : `Nothing you save will survive: ${storage?.problem} Nothing here needs a redeploy unless you replace the token itself.`
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
