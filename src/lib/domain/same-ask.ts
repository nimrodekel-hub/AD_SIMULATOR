import type { ClarificationRound, DifficultyLevel } from "./schemas";

/**
 * When two trainees have asked for the same thing.
 *
 * The rule on its own, with nothing behind it: no store, no session, no model.
 * It decides whether an engagement already laid out answers the ask in front
 * of us, and that decision is worth being able to state, read and test by
 * itself — the code that goes looking for the exercise is a separate thing
 * and lives in `store/reuse-exercise`.
 *
 * **Deliberately strict.** The trainee's own words shape the engagement:
 * "make me run out of interceptors" is an instruction, and answering it with
 * an exercise built for somebody else's sentence would be the failure this
 * codebase refuses everywhere else — a request that comes back looking as
 * though it was never read. So anything the words actually change makes it a
 * different ask.
 */

/** What a trainee asked for, in the only terms that decide reuse. */
export interface Ask {
  systemId: string;
  scenarioId: string;
  difficulty: DifficultyLevel;
  requestedText: string;
  clarifications: ClarificationRound[];
}

/**
 * The same words, allowing for the ways a person retypes a sentence.
 *
 * Case and spacing are not part of what somebody asked for — "Make me run out
 * of interceptors" and "make me run out of interceptors " are one request, and
 * treating them as two would generate a second exercise for no reason. Nothing
 * beyond that is normalised: a word changed is a different ask, and guessing
 * which changes are immaterial is how a request quietly stops being honoured.
 */
function said(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Whether two asks are the same request in different keystrokes. */
export function sameAsk(a: Ask, b: Ask): boolean {
  if (a.systemId !== b.systemId) return false;
  if (a.scenarioId !== b.scenarioId) return false;
  if (a.difficulty !== b.difficulty) return false;
  if (said(a.requestedText) !== said(b.requestedText)) return false;

  /* Clarifications are answers to questions that were asked in order, so the
     order is part of the ask: the same answers given to different questions
     mean something else entirely. */
  const mine = a.clarifications.filter((round) => said(round.answer).length > 0);
  const theirs = b.clarifications.filter(
    (round) => said(round.answer).length > 0,
  );
  if (mine.length !== theirs.length) return false;
  return mine.every(
    (round, index) =>
      said(round.question) === said(theirs[index].question) &&
      said(round.answer) === said(theirs[index].answer),
  );
}
