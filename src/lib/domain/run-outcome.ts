import type { Outcome, RunResult, SuccessCriteria } from "./schemas";

/**
 * What a run added up to, said without asking a model.
 *
 * A run has two halves and they were wrongly welded together. One half is
 * countable: how many hostiles were destroyed, how many leaked, whether a
 * friendly was engaged, how many rounds went. The engine already knows all of
 * it the instant the clock stops — it is what the engine spent the run
 * enforcing. The other half is judgement: what the trainee should learn from
 * the way they got there, which is the model's job and the scenario's rubric.
 *
 * Until now the countable half was only ever shown if the judgement half
 * succeeded. A run where every hostile was destroyed came back as "this run
 * has not been completed yet" because the assessment call had failed —
 * reporting a model's bad minute as a trainee's unfinished work, and losing
 * a success that had already happened.
 *
 * So the countable half is computed here, from the tally alone, and nothing
 * in this file can fail. The prose arrives later if it arrives.
 */

/**
 * The four things a run is passed or failed on, each answered separately.
 *
 * `met_criteria` is a single boolean over four conditions, and a trainee shown
 * only the boolean cannot tell which one broke — a run lost on one round too
 * many reads exactly like a run lost on fratricide. The prose summary said it,
 * but a paragraph is the wrong shape for four yes/no answers: you have to read
 * all of it to find the one that went wrong.
 *
 * These are the same four conditions the engine ands together, in the same
 * order, so the list cannot drift from the verdict it explains.
 */
export interface Criterion {
  /** What was required, as a statement that is either true of the run or not. */
  label: string;
  met: boolean;
  /** What actually happened against what was allowed. */
  detail: string;
}

export function criteriaOf(
  result: RunResult,
  criteria: SuccessCriteria,
): Criterion[] {
  return [
    {
      label: "Nothing hostile reached the defended area",
      met: result.leakers <= criteria.max_leakers,
      detail:
        criteria.max_leakers > 0
          ? `${result.leakers} reached it, ${criteria.max_leakers} allowed`
          : `${result.leakers} reached it, none allowed`,
    },
    {
      label: "Nothing friendly was engaged",
      met: result.friendly_engaged === 0,
      detail:
        result.friendly_engaged === 0
          ? "none engaged"
          : `${result.friendly_engaged} engaged — this fails a run on its own`,
    },
    {
      label: "The engagement was seen through",
      met: result.hostiles_unresolved === 0,
      detail:
        result.hostiles_unresolved === 0
          ? "nothing hostile left in the air"
          : `${result.hostiles_unresolved} still inbound when the run stopped`,
    },
    {
      label: "Rounds were spent within the allowance",
      met: result.interceptors_spent <= criteria.max_interceptors_spent,
      detail: `${result.interceptors_spent} spent of ${criteria.max_interceptors_spent} allowed`,
    },
  ];
}

/**
 * Which band a grade falls in, and what to call it.
 *
 * The number alone was doing too much work. Shown bare, out of nothing, "8"
 * reads like eight out of ten — a decent mark — when it is eight out of a
 * hundred and the worst result the rubric can give. The scale goes beside it
 * on screen; this says what the number *means*, in a word and a colour, so
 * the reading does not depend on knowing the rubric.
 */
export function gradeBand(score: number): {
  label: string;
  /** Maps to the status colours: danger, warn, ok. */
  tone: "danger" | "warn" | "ok";
} {
  if (score < 50) return { label: "Poor", tone: "danger" };
  if (score < 75) return { label: "Fair", tone: "warn" };
  return { label: "Good", tone: "ok" };
}

/** Whether the run met the criteria, in the words the criteria are set in. */
export function outcomeOf(
  result: RunResult,
  criteria: SuccessCriteria,
): Outcome {
  return {
    success: result.met_criteria,
    summary: summaryOf(result, criteria),
    /* Empty by design. `per_decision` belongs to the quiz this replaced — a
       list of multiple-choice answers against the preferred one. A flown run
       has an event log instead, and reading it is the debrief's work. */
    per_decision: [],
  };
}

/**
 * One line per criterion, each saying whether it was met and by how much.
 *
 * Written as sentences rather than a verdict because "not met" on its own
 * teaches nothing: an operator who stopped four of five hostiles and one who
 * engaged a friendly both fail, and they need to hear different things.
 */
export function summaryOf(
  result: RunResult,
  criteria: SuccessCriteria,
): string {
  const lines: string[] = [];

  const engaged = result.hostiles_destroyed + result.leakers;
  lines.push(
    result.leakers === 0
      ? `No hostile reached the defended area${
          engaged > 0 ? ` — all ${engaged} were stopped` : ""
        }.`
      : `${result.leakers} hostile${result.leakers === 1 ? "" : "s"} reached ` +
        `the defended area, against a limit of ${criteria.max_leakers}.`,
  );

  /* Said before anything about efficiency, because it is the reason a run
     ended early reads as a failure rather than as a clean sheet: nothing had
     leaked and nothing friendly had been engaged, and that is only because
     the engagement was left unfinished. */
  if (result.hostiles_unresolved > 0) {
    lines.push(
      `${result.hostiles_unresolved} hostile${
        result.hostiles_unresolved === 1 ? " was" : "s were"
      } still inbound when the run stopped, neither destroyed nor arrived. ` +
        "A hostile still closing is not a hostile dealt with.",
    );
  }

  if (result.friendly_engaged > 0) {
    lines.push(
      `${result.friendly_engaged} friendly track${
        result.friendly_engaged === 1 ? " was" : "s were"
      } engaged. That fails the run on its own, whatever else went right.`,
    );
  }

  if (result.unknown_engaged > 0) {
    lines.push(
      `${result.unknown_engaged} track${
        result.unknown_engaged === 1 ? "" : "s"
      } still showing as unidentified ${
        result.unknown_engaged === 1 ? "was" : "were"
      } engaged.`,
    );
  }

  lines.push(
    result.interceptors_spent <= criteria.max_interceptors_spent
      ? `${result.interceptors_spent} interceptor${
          result.interceptors_spent === 1 ? "" : "s"
        } spent, within the ${criteria.max_interceptors_spent} allowed.`
      : `${result.interceptors_spent} interceptors spent, against the ` +
        `${criteria.max_interceptors_spent} allowed.`,
  );

  if (result.mean_reaction_s !== null) {
    lines.push(
      `Mean ${result.mean_reaction_s}s from a hostile becoming identifiable ` +
        `to the launch against it.`,
    );
  }

  return lines.join(" ");
}
