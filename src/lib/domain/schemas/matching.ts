import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Matching engine                                                     */
/* ------------------------------------------------------------------ */

export const MatchResultSchema = z.object({
  /** Id of the best-matching approved scenario, or "" if nothing fits at all. */
  scenario_entry_id: z.string(),
  /** 0.0 - 1.0. Below the clarification threshold triggers a follow-up question. */
  confidence: z.number(),
  /** One sentence: why this scenario matches the request. */
  reasoning: z.string(),
  /** Populated only when confidence is low; "" otherwise. */
  clarifying_question: z.string(),
  /** Difficulty inferred from the request's wording. */
  suggested_difficulty: z.enum(["easy", "medium", "hard"]),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;
