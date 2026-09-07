import Link from "next/link";
import { notFound } from "next/navigation";
import { AssessmentPending } from "@/components/assessment-pending";
import { ScreenShell } from "@/components/screen-shell";
import { criteriaOf, gradeBand, summaryOf } from "@/lib/domain/run-outcome";
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

/**
 * Written out rather than built from the tone.
 *
 * Tailwind generates a utility only where it finds the whole class name in the
 * source, so `text-${tone}` produces markup with a class that does not exist —
 * silently, and only for whichever band nothing else on the site happens to
 * use. Spelling all three keeps them real.
 */
const TONE_TEXT = {
  danger: "text-danger",
  warn: "text-warn",
  ok: "text-ok",
} as const;

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

  /* The four conditions behind the verdict, and what to call the grade. Both
     are derived rather than stored, so an old record shows them too. */
  const criteria = criteriaOf(result, session.exercise_instance.success_criteria);
  const grade = session.score === null ? null : gradeBand(session.score);

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
      {/* The grade carries the scale with it. On its own, out of nothing, "8"
          reads like eight out of ten — a fair mark — when it is eight out of a
          hundred and the worst the rubric gives. The denominator, the word for
          the band and the colour all say the same thing, so none of them has
          to be understood alone. */}
      <div className="panel flex flex-wrap items-center gap-x-8 gap-y-5 p-6">
        <div>
          <p className="label !mb-1">Grade</p>
          {/* An unscored run shows a dash, not a nought. A grade is the
              scenario's rubric applied by the model, and printing 0 for
              "nobody has applied it yet" reads as the worst possible result
              for a run that may have been flawless. */}
          {session.score === null ? (
            <>
              <p className="data text-4xl font-semibold text-muted">—</p>
              <p className="mt-1 text-xs text-muted">not graded yet</p>
            </>
          ) : (
            <>
              <p className="data text-4xl font-semibold leading-none">
                <span className={TONE_TEXT[grade!.tone]}>
                  {Math.round(session.score)}
                </span>
                <span className="text-xl font-normal text-muted"> / 100</span>
              </p>
              <p
                className={`mt-1.5 text-xs font-semibold ${TONE_TEXT[grade!.tone]}`}
              >
                {grade!.label}
              </p>
            </>
          )}
        </div>

        <div className="min-w-[16rem] flex-1">
          <span className={`chip ${outcome.success ? "status-ok" : "status-danger"}`}>
            {outcome.success ? "Mission success" : "Mission failed"}
          </span>
          <p className="prose-block mt-2 text-sm text-muted">{outcome.summary}</p>
        </div>
      </div>

      {/* ---- Why it passed or failed -------------------------------- */}
      {/* The verdict above is one boolean over four conditions, and a trainee
          shown only the boolean cannot tell which one broke: a run lost on one
          round too many looks exactly like a run lost on fratricide. Four
          rows, in the engine's own order, answer that at a glance. */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold">What it was judged on</h2>
        <ul className="panel mt-3 divide-y divide-[var(--border)]">
          {criteria.map((criterion) => (
            <li
              key={criterion.label}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3"
            >
              <span
                aria-hidden
                className={`text-sm font-semibold ${criterion.met ? "text-ok" : "text-danger"}`}
              >
                {criterion.met ? "✓" : "✗"}
              </span>
              <span className="text-sm">{criterion.label}</span>
              <span className="data ml-auto text-xs text-muted">
                {criterion.detail}
              </span>
            </li>
          ))}
        </ul>
        {session.exercise_instance.success_criteria.statement ? (
          <p className="prose-block mt-3 text-xs text-muted">
            {session.exercise_instance.success_criteria.statement}
          </p>
        ) : null}
      </section>

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
        {/* Each figure carries a line saying what it means. They are terms of
            art — "leakers", "mean reaction" — and a trainee reading their own
            result should not have to already know the vocabulary to find out
            how they did. The three fates of a hostile come first, in order,
            because together they account for every track in the run. */}
        <dl className="mt-3 grid grid-cols-1 gap-px overflow-hidden rounded border border-line bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
          <Tally
            label="Hostiles destroyed"
            value={result.hostiles_destroyed}
            hint="Shot down before they arrived."
          />
          <Tally
            label="Reached the site"
            value={result.leakers}
            bad={result.leakers > 0}
            hint="Got through to the defended area."
          />
          {/* The third possible fate, and the one that used to be invisible:
              neither destroyed nor arrived. It only becomes common now that a
              run can be ended on purpose, and it is what stops "I stopped
              immediately" from scoring as a clean sheet. */}
          <Tally
            label="Still inbound"
            value={result.hostiles_unresolved}
            bad={result.hostiles_unresolved > 0}
            hint="Still closing when the run stopped — neither stopped nor arrived."
          />
          <Tally
            label="Friendlies engaged"
            value={result.friendly_engaged}
            bad={result.friendly_engaged > 0}
            hint="Fired on and it was not a threat. Fails a run on its own."
          />
          <Tally
            label="Rounds spent"
            value={result.interceptors_spent}
            hint={`Interceptors fired, of ${session.exercise_instance.success_criteria.max_interceptors_spent} allowed.`}
          />
          <Tally
            label="Mean reaction"
            /* Whole seconds. A tenth of a second of mean reaction is not a
               distinction anybody acts on, and "109.4s" was wide enough to
               run into its own label. */
            value={
              result.mean_reaction_s === null
                ? "—"
                : `${Math.round(result.mean_reaction_s)}s`
            }
            hint="From a hostile becoming identifiable to you firing on it."
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
            <AssessmentPending
              sessionId={sessionId}
              log={session.run_log}
              result={result}
            />
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
  hint,
  bad = false,
}: {
  label: string;
  value: number | string;
  /** One line of plain English, so the label need not already be understood. */
  hint: string;
  bad?: boolean;
}) {
  /* A div wrapping one dt/dd pair is the sanctioned way to group them inside a
     dl. The number is ordered first visually because that is what the eye
     scans, while the DOM keeps term before definition. */
  return (
    <div className="flex items-baseline gap-4 bg-panel p-4">
      <dt className="order-2 min-w-0 text-xs font-semibold">
        {label}
        <span className="mt-0.5 block font-normal leading-snug text-muted">
          {hint}
        </span>
      </dt>
      <dd
        /* A floor rather than a fixed width, so the columns line up on the
           usual one- and two-digit counts without a wider value colliding
           with its own label. */
        className={`data order-1 min-w-14 shrink-0 whitespace-nowrap text-2xl font-semibold ${bad ? "text-danger" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
