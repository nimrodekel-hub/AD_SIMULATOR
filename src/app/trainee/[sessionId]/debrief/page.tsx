import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { getScenario } from "@/lib/store/kb";
import { getSession } from "@/lib/store/sessions";

/**
 * Screen 4 — the debrief.
 *
 * Working-surface theme, not operations-room: this is read slowly, and it is
 * where the actual learning happens. Everything shown here is grounded in the
 * knowledge base — the comments against each moment are the expert's own
 * reasoning, and the tally beside the score was counted by the simulation from
 * the run itself rather than judged by anything.
 */

export const dynamic = "force-dynamic";

export default async function DebriefPage({
  params,
}: PageProps<"/trainee/[sessionId]/debrief">) {
  const { sessionId } = await params;
  const session = await getSession(sessionId);
  if (!session) notFound();

  const scenario = await getScenario(session.system_id, session.scenario_entry_id);
  const outcome = session.outcome;

  if (session.status !== "completed" || !outcome) {
    return (
      <ScreenShell theme="work" eyebrow="Trainee · Debrief" title="Not finished">
        <div className="panel p-8 text-center">
          <p className="text-sm">This run has not been completed yet.</p>
          <Link href={`/trainee/${sessionId}`} className="btn btn-primary mt-6">
            Back to the run
          </Link>
        </div>
      </ScreenShell>
    );
  }

  const score = session.score ?? 0;

  return (
    <ScreenShell
      theme="work"
      eyebrow="Trainee · Debrief"
      title={session.exercise_instance.exercise_name}
      subtitle={scenario?.title}
    >
      {/* ---- Result ------------------------------------------------- */}
      <div className="panel flex flex-wrap items-center gap-6 p-6">
        <div>
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted">
            Score
          </p>
          <p className="data mt-1 text-4xl font-semibold">{Math.round(score)}</p>
        </div>
        <div className="flex-1">
          <span className={`chip ${outcome.success ? "status-ok" : "status-danger"}`}>
            {outcome.success ? "Mission success" : "Mission failed"}
          </span>
          <p className="mt-2 text-sm text-muted">{outcome.summary}</p>
        </div>
      </div>

      {/* ---- What the simulation counted ---------------------------- */}
      {session.run_result ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold">The tally</h2>
          <p className="mt-1 text-xs text-muted">
            Counted from the run itself. These are not judgements and nothing
            can argue with them — the assessment above explains how they came
            about.
          </p>
          <dl className="data mt-3 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-5">
            <Tally
              label="Hostiles destroyed"
              value={session.run_result.hostiles_destroyed}
            />
            <Tally
              label="Reached the site"
              value={session.run_result.leakers}
              bad={session.run_result.leakers > 0}
            />
            <Tally
              label="Friendlies engaged"
              value={session.run_result.friendly_engaged}
              bad={session.run_result.friendly_engaged > 0}
            />
            <Tally
              label="Rounds spent"
              value={session.run_result.interceptors_spent}
            />
            <Tally
              label="Mean reaction"
              value={
                session.run_result.mean_reaction_s === null
                  ? "—"
                  : `${session.run_result.mean_reaction_s}s`
              }
            />
          </dl>
        </section>
      ) : null}

      {/* ---- The debrief itself ------------------------------------- */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold">What happened</h2>
        <div className="panel prose-block mt-3 whitespace-pre-wrap p-5 text-sm">
          {session.debrief_text}
        </div>
      </section>

      {/* ---- The moments that decided it ---------------------------- */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold">The moments that decided it</h2>
        <p className="mt-1 text-xs text-muted">
          The turning points of the run, taken from what actually happened. The
          comments come from the knowledge base — the reasoning the domain
          expert recorded when this scenario was captured.
        </p>
        <ol className="mt-4 space-y-3">
          {outcome.per_decision.map((entry) => (
            <li key={entry.dilemma_index} className="panel p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`chip ${entry.correct ? "status-ok" : "status-danger"}`}
                >
                  {entry.correct ? "well handled" : "cost you"}
                </span>
              </div>

              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted">You:</dt>
                  <dd>{entry.chosen_action}</dd>
                </div>
                {!entry.correct ? (
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted">The record says:</dt>
                    <dd className="text-ok">{entry.preferred_action}</dd>
                  </div>
                ) : null}
              </dl>

              <p className="prose-block mt-3 border-t border-line pt-3 text-sm text-muted">
                {entry.comment}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---- Next ---------------------------------------------------- */}
      {session.recommendations.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Practise next</h2>
          <ul className="panel mt-3 divide-y divide-[var(--border)]">
            {session.recommendations.map((recommendation, index) => (
              <li key={index} className="px-5 py-3 text-sm">
                {recommendation}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-10 flex flex-wrap gap-3 border-t border-line pt-6">
        <Link href="/trainee" className="btn btn-primary">
          Run it again
        </Link>
        <Link href="/" className="btn">
          Done
        </Link>
      </div>
    </ScreenShell>
  );
}

/**
 * One counted figure.
 *
 * Deliberately plain: these are facts about the run, and dressing them up
 * would blur the line between what happened and what somebody thought of it.
 * Only the two that fail a run are coloured.
 */
function Tally({
  label,
  value,
  bad = false,
}: {
  label: string;
  value: number | string;
  bad?: boolean;
}) {
  return (
    <div className="bg-panel p-4">
      <dt className="text-[0.625rem] uppercase tracking-[0.1em] text-muted">
        {label}
      </dt>
      <dd className={`mt-1 text-2xl font-semibold ${bad ? "text-danger" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
