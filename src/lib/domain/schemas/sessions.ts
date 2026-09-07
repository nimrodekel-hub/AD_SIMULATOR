import { z } from "zod";
import {
  ExerciseInstanceSchema,
  RunResultSchema,
  SimEventSchema,
} from "./exercise";
import { RevisionSchema } from "./gui";

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export const DifficultyLevelSchema = z.enum(["easy", "medium", "hard"]);
export type DifficultyLevel = z.infer<typeof DifficultyLevelSchema>;

/**
 * An exercise kept in its own right, rather than only inside the run it was
 * generated for.
 *
 * Every exercise the generator produces used to exist in exactly one place: a
 * trainee's session. That made the whole library invisible — nobody could look
 * at what had been generated, and a bad exercise could only be discovered by
 * flying it and could not be corrected at all.
 *
 * A record here is either an exercise a designer has taken hold of to correct,
 * or the corrected result. **A session is never rewritten.** Its debrief and
 * its score describe what was actually flown, so revising a flown exercise
 * produces one of these instead and leaves the record of the run alone.
 */
export const SavedExerciseSchema = z.object({
  id: z.string(),
  /** The system it is flown on. Its profile bounds everything in the exercise. */
  system_id: z.string(),
  /** The scenario it teaches. Kept so a revision can be regenerated from it. */
  scenario_entry_id: z.string(),
  difficulty_level: DifficultyLevelSchema,
  exercise_instance: ExerciseInstanceSchema,
  /**
   * What was asked of it and what came back, oldest first.
   *
   * Sent whole with every revision, for the same reason the console's thread
   * is: a correction that honours the newest request while undoing the last
   * one is how this goes in circles.
   */
  revisions: z.array(RevisionSchema).default([]),
  /**
   * Where it came from, in one line, for the library listing.
   *
   * An exercise lifted out of a run says so, and names the run — because the
   * run's debrief is the evidence for whatever was wrong with it.
   */
  source: z.string().default(""),
  /** The run it was lifted from, when it was. Empty for a fresh generation. */
  from_session_id: z.string().default(""),
  created_at: z.string(),
  updated_at: z.string().default(""),
});
export type SavedExercise = z.infer<typeof SavedExerciseSchema>;

export const ClarificationRoundSchema = z.object({
  question: z.string(),
  answer: z.string(),
});
export type ClarificationRound = z.infer<typeof ClarificationRoundSchema>;

export const DecisionMadeSchema = z.object({
  dilemma_index: z.number().int(),
  chosen_action: z.string(),
  /** Milliseconds from when the dilemma was shown to when it was answered. */
  elapsed_ms: z.number(),
});
export type DecisionMade = z.infer<typeof DecisionMadeSchema>;

export const OutcomeSchema = z.object({
  success: z.boolean(),
  /** Which parts of the success condition were met, and which were not. */
  summary: z.string(),
  per_decision: z.array(
    z.object({
      dilemma_index: z.number().int(),
      chosen_action: z.string(),
      preferred_action: z.string(),
      correct: z.boolean(),
      /** Drawn from the KB rationale / common_errors — not invented. */
      comment: z.string(),
    }),
  ),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export const DebriefSchema = z.object({
  score: z.number(),
  outcome: OutcomeSchema,
  /** Prose debrief for the trainee: what worked, what did not, and why. */
  debrief_text: z.string(),
  /** Concrete suggestions for the next training run. */
  recommendations: z.array(z.string()),
});
export type Debrief = z.infer<typeof DebriefSchema>;

export const SessionStatusSchema = z.enum(["in_progress", "completed"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  trainee_id: z.string(),
  /** Which simulated system this run was on. Fixed at creation: the console
      and the profile it renders with must not change under a finished run. */
  system_id: z.string(),
  scenario_entry_id: z.string(),
  requested_text: z.string(),
  clarification_rounds: z.array(ClarificationRoundSchema),
  difficulty_level: DifficultyLevelSchema,
  exercise_instance: ExerciseInstanceSchema,
  /** Legacy: the answers chosen, for runs recorded before the simulator. */
  decisions_made: z.array(DecisionMadeSchema),
  /** What actually happened, second by second. The debrief is built from this. */
  run_log: z.array(SimEventSchema).default([]),
  /** What it added up to, counted by the engine rather than judged by a model. */
  run_result: RunResultSchema.nullable().default(null),
  outcome: OutcomeSchema.nullable(),
  score: z.number().nullable(),
  debrief_text: z.string(),
  recommendations: z.array(z.string()),
  status: SessionStatusSchema,
  created_at: z.string(),
  completed_at: z.string().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

export const TraineeSchema = z.object({
  id: z.string(),
  name: z.string(),
  notes: z.string(),
  created_at: z.string(),
});
export type Trainee = z.infer<typeof TraineeSchema>;

export const InstructorSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
});
export type Instructor = z.infer<typeof InstructorSchema>;
