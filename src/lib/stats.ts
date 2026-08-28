import type { Session } from "./domain/schemas";

/**
 * The instructor's numbers, derived from the session log.
 *
 * Only completed runs count towards scores: an abandoned run has no score, and
 * treating it as a zero would punish a trainee for closing a tab.
 */

export interface TraineeStats {
  /** Every run, finished or not. */
  runs: number;
  completed: number;
  /** Scores oldest-first, so a chart reads left to right. */
  scores: number[];
  /** Session ids matching `scores`, same order. */
  scoreLabels: string[];
  latest: number | null;
  average: number | null;
  /**
   * Latest score against the average of everything before it. Null until there
   * is something to compare against — a first run has no trend.
   */
  delta: number | null;
  /** Share of completed runs that met the success condition. */
  successRate: number | null;
  lastRunAt: string | null;
}

export function summarise(sessions: Session[]): TraineeStats {
  // The store returns newest-first; charts and trends read the other way.
  const chronological = [...sessions].reverse();
  const completed = chronological.filter(
    (session) => session.status === "completed" && session.score !== null,
  );

  const scores = completed.map((session) => session.score as number);
  const average =
    scores.length > 0
      ? scores.reduce((total, score) => total + score, 0) / scores.length
      : null;

  const latest = scores.length > 0 ? scores[scores.length - 1] : null;

  const priorScores = scores.slice(0, -1);
  const priorAverage =
    priorScores.length > 0
      ? priorScores.reduce((total, score) => total + score, 0) / priorScores.length
      : null;

  const successes = completed.filter(
    (session) => session.outcome?.success === true,
  ).length;

  return {
    runs: sessions.length,
    completed: completed.length,
    scores,
    scoreLabels: completed.map((session) =>
      new Date(session.created_at).toLocaleDateString(),
    ),
    latest,
    average,
    delta:
      latest !== null && priorAverage !== null ? latest - priorAverage : null,
    successRate:
      completed.length > 0 ? successes / completed.length : null,
    lastRunAt: sessions[0]?.created_at ?? null,
  };
}

/** Score bands, shared by the roster and the drill-down so they never disagree. */
export function scoreTone(score: number | null): "ok" | "warn" | "danger" {
  if (score === null) return "warn";
  if (score >= 75) return "ok";
  if (score >= 50) return "warn";
  return "danger";
}
