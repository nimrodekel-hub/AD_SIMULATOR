import Link from "next/link";
import { notFound } from "next/navigation";
import { AssessmentRetry } from "@/components/assessment-retry";
import { ScreenShell } from "@/components/screen-shell";
import { summaryOf } from "@/lib/domain/run-outcome";
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
  const result = session.run_result;

  /**
   * The one thing that makes this page impossible is a run nobody flew.
   *
   * It used to also refuse a run with no `outcome`, which meant refusing every
   * run whose written assessment had failed — telling a trainee who had
   * destroyed every hostile that they had not finished. The tally is what this
   * page is for, the engine produces it without help, and it is present from
   * the moment the clock stops.
   */
  if (!result) {
    return (
      <ScreenShell theme="work" eyebrow="Trainee · Debrief" title="Not finished">
        <div className="panel p-8 text-center">
          <p className="text-sm">This run has not been flown yet.</p>
          <Link href={`/trainee/${sessionId}`} className="btn btn-primary mt-6">
            Back to the run
          </Link>
        </div>
      </ScreenShell>
    );
  }

  /* The objective close always writes one; a record from before it existed
     may not have one, and the tally answers the same question. */
  const outcome = session.outcome ?? {
    success: result.met_criteria,
    summary: summaryOf(result, session.exercise_instance.success_criteria),
    per_decision: [],
  };

  /** Whether a model has written about the run yet. Nothing here waits on it. */
  const assessed = session.debrief_text.trim().length > 0;

  return (
    <ScreenShell
      theme="work"
      eyebrow="Trainee · Debrief"
      title={session.exercise_instance.exercise_name}
      subtitle={scenario?.title}
    >
      {/* ---- What was asked for ------------------------------------- */}
      {/* Stated before the score, because it is what the score is about:
          the exercise was laid out to deliver this, and both the trainee and
          the instructor reading it later are owed the two facts side by
          side. It used to live only on the instructor's history page. */}
      {session.requested_text ? (
        <div className="panel mb-4 border-l-2 border-l-accent p-4">
          <p className="label !mb-1">What you asked for</p>
          <p className="text-sm">“{session.requested_text}”</p>
          {session.clarification_rounds.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {session.clarification_rounds.map((round, index) => (
                <li key={index} className="text-xs leading-relaxed text-muted">
                  <span className="text-ink">{round.question}</span> —{" "}
                  {round.answer}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ---- Result ------------------------------------------------- */}
      <div className="panel flex flex-wrap items-center gap-6 p-6">
        <div>
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted">
            Score
          </p>
          {/* An unscored run shows a dash, not a nought. A score is the
              scenario's rubric applied by the model, and printing 0 for
              "nobody has applied it yet" reads as the worst possible result
              for a run that may have been flawless. */}
          <p className="data mt-1 text-4xl font-semibold">
            {session.score === null ? (
              <span className="text-muted">—</span>
            ) : (
              Math.round(session.score)
            )}
          </p>
        </div>
        <div className="flex-1">
          <span className={`chip ${outcome.success ? "status-ok" : "status-danger"}`}>
            {outcome.success ? "Mission success" : "Mission failed"}
          </span>
          <p className="mt-2 text-sm text-muted">{outcome.summary}</p>
        </div>
      </div>

      {/* ---- What the simulation counted ---------------------------- */}
      {/* Unconditional, and first. This is the result of the run: the engine
          counted it while enforcing the rules, it needs nothing else to be
          true, and it is what a trainee walking away from the console has
          actually earned. */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold">The tally</h2>
        <p className="mt-1 text-xs text-muted">
          Counted from the run itself. These are not judgements and nothing can
          argue with them.
        </p>
        <dl className="data mt-3 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-[var(--border)] sm:grid-cols-3 lg:grid-cols-6">
          <Tally label="Hostiles destroyed" value={result.hostiles_destroyed} />
          <Tally
            label="Reached the site"
            value={result.leakers}
            bad={result.leakers > 0}
          />
          {/* The third possible fate, and the one that used to be invisible:
              neither destroyed nor arrived. It only becomes common now that a
              run can be ended on purpose, and it is what stops "I stopped
              immediately" from scoring as a clean sheet. */}
          <Tally
            label="Still inbound"
            value={result.hostiles_unresolved}
            bad={result.hostiles_unresolved > 0}
          />
          <Tally
            label="Friendlies engaged"
            value={result.friendly_engaged}
            bad={result.friendly_engaged > 0}
          />
          <Tally label="Rounds spent" value={result.interceptors_spent} />
          <Tally
            label="Mean reaction"
            value={
              result.mean_reaction_s === null
                ? "—"
                : `${result.mean_reaction_s}s`
            }
          />
        </dl>

        {/* Which rounds went, where the system carries more than one. The
            total answers "did they spend too many"; only this answers the
            sharper question, "did they spend the wrong ones". */}
        {Object.keys(result.spent_by).length > 1 ? (
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
            {Object.entries(result.spent_by).map(([round, spent]) => (
              <li key={round}>
                <span className="text-ink">{spent}</span> × {round}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* ---- The debrief itself ------------------------------------- */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold">What happened</h2>
        {assessed ? (
          <div className="panel prose-block mt-3 whitespace-pre-wrap p-5 text-sm">
            {session.debrief_text}
          </div>
        ) : (
          /* The one part of this page that needs a model, and therefore the
             one part that can be missing. Said plainly, beside the result it
             does not affect, rather than in place of it. */
          <div className="panel mt-3 p-5">
            <p className="text-sm">
              The written assessment has not been produced for this run. Your
              result above is final and saved — this is the reading of{" "}
              <em>how</em> you got there, and it is the only thing still
              outstanding.
            </p>
            <div className="mt-4">
              <AssessmentRetry
                sessionId={sessionId}
                log={session.run_log}
                result={result}
              />
            </div>
          </div>
        )}
      </section>

      {/* ---- The moments that decided it ---------------------------- */}
      {/* Only where there are any. This section belongs to the quiz shape a
          run used to have; a flown run leaves an event log instead, and an
          empty list under a confident heading reads as something lost. */}
      {outcome.per_decision.length > 0 ? (
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
      ) : null}

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
