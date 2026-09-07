import { z } from "zod";

/* ------------------------------------------------------------------ */
/* General knowledge — the step before any system                      */
/* ------------------------------------------------------------------ */

/**
 * One thing worth knowing that is true across systems, not inside one.
 *
 * Kept as a list rather than folded into the briefing prose so that a lesson
 * can be added, corrected or removed on its own, without editing a wall of
 * text and without disturbing the rest.
 */
export const LessonSchema = z.object({
  id: z.string(),
  /** A short name. Shown in the list and used to find it again. */
  title: z.string().min(1),
  /** The lesson itself, in the designer's own words. */
  body: z.string().min(1),
});
export type Lesson = z.infer<typeof LessonSchema>;

/**
 * What every interviewer is told, before any particular system is discussed.
 *
 * This is the layer above the per-system profile: how air defence works in
 * general, plus the lessons that keep proving true across systems. It is
 * editable because it is doctrine in the ordinary sense — it accumulates, it
 * gets corrected, and the person correcting it is the domain expert, not the
 * model.
 *
 * It is orientation, never authority about a particular system. Where it and a
 * system's approved profile disagree, the profile wins; where it and the expert
 * disagree, the expert wins.
 */
export const GeneralKnowledgeSchema = z.object({
  /** The background briefing, as markdown. */
  briefing: z.string(),
  lessons: z.array(LessonSchema),
  updated_at: z.string(),
});
export type GeneralKnowledge = z.infer<typeof GeneralKnowledgeSchema>;
