import Link from "next/link";
import { notFound } from "next/navigation";
import { ScreenShell } from "@/components/screen-shell";
import { getDilemma } from "@/lib/store/kb";
import { getSession } from "@/lib/store/sessions";

/**
 * Screen 4 — the debrief.
 *
 * Working-surface theme, not operations-room: this is read slowly, and it is
 * where the actual learning happens. Everything shown here is grounded in the
 * knowledge base — the per-decision comments are the expert's own reasoning.
 */

export const dynamic = "force-dynamic";

export default async function DebriefPage({
  params,
}: PageProps<"/trainee/[sessionId]/debrief">) {
  const { sessionId } = await params;
  const session = await getSession(sessionId);
  if (!session) notFound();

  const dilemma = await getDilemma(session.system_id, session.dilemma_entry_id);
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
      title={session.scenario_instance.scenario_name}
      subtitle={dilemma?.title}
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

      {/* ---- The debrief itself ------------------------------------- */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold">What happened</h2>
        <div className="panel prose-block mt-3 whitespace-pre-wrap p-5 text-sm">
          {session.debrief_text}
        </div>
      </section>

      {/* ---- Decision by decision ----------------------------------- */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold">Decision by decision</h2>
        <p className="mt-1 text-xs text-muted">
          The comments below come from the knowledge base — the reasoning the
          domain expert recorded when this dilemma was captured.
        </p>
        <ol className="mt-4 space-y-3">
          {outcome.per_decision.map((entry) => (
            <li key={entry.decision_point_index} className="panel p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`chip ${entry.correct ? "status-ok" : "status-danger"}`}
                >
                  {entry.correct ? "correct" : "missed"}
                </span>
                <p className="text-xs text-muted">
                  Decision {entry.decision_point_index + 1}
                </p>
              </div>

              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted">You chose:</dt>
                  <dd>{entry.chosen_action}</dd>
                </div>
                {!entry.correct ? (
                  <div className="flex flex-wrap gap-x-2">
                    <dt className="text-muted">Preferred:</dt>
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
