import Link from "next/link";
import { notFound } from "next/navigation";
import { ScoreHistoryChart } from "@/components/score-trend";
import { ScreenShell } from "@/components/screen-shell";
import { scoreTone, summarise } from "@/lib/stats";
import { listAllDilemmas, listSystems } from "@/lib/store/kb";
import { getTrainee, listSessionsForTrainee } from "@/lib/store/sessions";

/**
 * Screen 2, drill-down — everything one trainee has done.
 *
 * The brief asks for every session, every decision and every debrief, so
 * nothing is summarised away. Runs are collapsed by default and open in place,
 * which keeps a long history scannable without hiding anything behind another
 * page load.
 */

export const dynamic = "force-dynamic";

export default async function TraineeHistoryPage({
  params,
}: PageProps<"/instructor/[traineeId]">) {
  const { traineeId } = await params;

  const [trainee, sessions, dilemmas, systems] = await Promise.all([
    getTrainee(traineeId),
    listSessionsForTrainee(traineeId),
    listAllDilemmas(),
    listSystems(),
  ]);
  if (!trainee) notFound();

  const stats = summarise(sessions);
  // Runs span systems, so a title is resolved without knowing which system it
  // came from, and the system is named alongside it.
  const titleFor = new Map(dilemmas.map((entry) => [entry.id, entry.title]));
  const systemFor = new Map(systems.map((system) => [system.id, system.name]));

  return (
    <ScreenShell
      theme="ops"
      eyebrow="Instructor · Trainee history"
      title={trainee.name}
      subtitle={`${stats.completed} completed · ${stats.runs} started`}
      contained={false}
      actions={
        <Link href={`/trainee?trainee=${trainee.id}`} className="btn">
          Start a run for this trainee
        </Link>
      }
    >
      <div className="space-y-4 p-4">
        {/* ---- Headline numbers ------------------------------------ */}
        <div className="grid gap-px bg-[var(--border)] sm:grid-cols-4">
          <Figure
            label="Latest"
            value={stats.latest === null ? "—" : String(Math.round(stats.latest))}
            tone={stats.latest === null ? undefined : scoreTone(stats.latest)}
          />
          <Figure
            label="Average"
            value={stats.average === null ? "—" : String(Math.round(stats.average))}
          />
          <Figure
            label="Success rate"
            value={
              stats.successRate === null
                ? "—"
                : `${Math.round(stats.successRate * 100)}%`
            }
          />
          <Figure
            label="Runs completed"
            value={`${stats.completed} / ${stats.runs}`}
          />
        </div>

        {/* ---- Trend ----------------------------------------------- */}
        {stats.scores.length > 0 ? (
          <section className="panel p-4">
            <div className="panel-header -mx-4 -mt-4 mb-4">Score by run</div>
            <ScoreHistoryChart
              scores={stats.scores}
              labels={stats.scoreLabels}
            />
          </section>
        ) : null}

        {/* ---- Every run ------------------------------------------- */}
        <section>
          <h2 className="mb-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted">
            Session history
          </h2>

          {sessions.length === 0 ? (
            <div className="panel p-8 text-center text-sm text-muted">
              This trainee has not run a scenario yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {sessions.map((session) => (
                <li key={session.id} className="panel">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-3 p-4">
                      <span
                        className={`chip ${
                          session.status !== "completed"
                            ? "status-warn"
                            : `status-${scoreTone(session.score)}`
                        }`}
                      >
                        {session.status !== "completed"
                          ? "abandoned"
                          : Math.round(session.score ?? 0)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {titleFor.get(session.dilemma_entry_id) ??
                          "(dilemma since removed)"}
                      </span>
                      <span className="data text-xs text-muted">
                        {systemFor.get(session.system_id) ?? "(system removed)"}
                      </span>
                      <span className="data text-xs text-muted">
                        {session.difficulty_level}
                      </span>
                      <span className="data text-xs text-muted">
                        {new Date(session.created_at).toLocaleString()}
                      </span>
                    </summary>

                    <div className="space-y-5 border-t border-line p-4">
                      {/* What they asked for, in their words */}
                      <Block label="Requested">
                        <p className="text-sm">
                          &ldquo;{session.requested_text}&rdquo;
                        </p>
                        {session.clarification_rounds.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-xs text-muted">
                            {session.clarification_rounds.map((round, index) => (
                              <li key={index}>
                                <span className="text-ink">{round.question}</span>{" "}
                                — {round.answer}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </Block>

                      {/* Every decision */}
                      <Block label="Decisions">
                        {session.outcome ? (
                          <ol className="space-y-2">
                            {session.outcome.per_decision.map((entry) => (
                              <li
                                key={entry.decision_point_index}
                                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
                              >
                                <span
                                  className={`chip ${entry.correct ? "status-ok" : "status-danger"}`}
                                >
                                  {entry.correct ? "correct" : "missed"}
                                </span>
                                <span>{entry.chosen_action}</span>
                                {!entry.correct ? (
                                  <span className="text-xs text-muted">
                                    preferred: {entry.preferred_action}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="text-sm text-muted">
                            {session.decisions_made.length} answered before the
                            run was abandoned; never evaluated.
                          </p>
                        )}
                      </Block>

                      {/* The debrief they were given */}
                      {session.debrief_text ? (
                        <Block label="Debrief">
                          <p className="prose-block whitespace-pre-wrap text-sm text-muted">
                            {session.debrief_text}
                          </p>
                        </Block>
                      ) : null}

                      {session.recommendations.length > 0 ? (
                        <Block label="Recommended next">
                          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                            {session.recommendations.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        </Block>
                      ) : null}

                      {session.status === "completed" ? (
                        <Link
                          href={`/trainee/${session.id}/debrief`}
                          className="btn text-xs"
                        >
                          Open the debrief as the trainee saw it
                        </Link>
                      ) : null}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ScreenShell>
  );
}

/**
 * Written out rather than interpolated: Tailwind generates utilities by finding
 * literal class strings in the source, so `text-${tone}` would produce a class
 * that never gets a rule.
 */
const TONE_CLASS = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
} as const;

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: keyof typeof TONE_CLASS;
}) {
  return (
    <div className="bg-panel px-4 py-3">
      <p className="text-[0.625rem] uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${tone ? TONE_CLASS[tone] : ""}`}>
        {value}
      </p>
    </div>
  );
}

function Block({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-accent">
        {label}
      </p>
      {children}
    </div>
  );
}
