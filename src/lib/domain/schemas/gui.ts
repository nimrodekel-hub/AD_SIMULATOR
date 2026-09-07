import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Simulated system GUI                                                */
/* ------------------------------------------------------------------ */

/**
 * One round of the designer telling the builder what to change.
 *
 * Kept as a list rather than a single "latest note" because the requests are
 * cumulative: "move the tracks to the right" is still in force when the next
 * message says "and make the header darker". Handing the model only the newest
 * one is how a console loses a change it was already asked for.
 */
export const RevisionSchema = z.object({
  /** What the designer asked for, in their words. */
  request: z.string(),
  /** What came back — the model's own account of what it changed. */
  notes: z.string().default(""),
  at: z.string().default(""),
});
export type Revision = z.infer<typeof RevisionSchema>;

/**
 * The same shape, under the name the console builder has always used.
 *
 * The pattern turned out to be general: a designer says what is wrong in
 * words, something is rebuilt, and what came back is recorded beside the
 * request. It is how consoles are corrected and now how exercises are, so the
 * schema is shared rather than copied.
 */
export const GuiRevisionSchema = RevisionSchema;
export type GuiRevision = Revision;

export const GuiTemplateSchema = z.object({
  /** Same value as the system's id — one console per system. */
  id: z.string(),
  /** Repo-relative paths of the uploaded reference screenshots. */
  source_screenshots: z.array(z.string()),
  /** Self-contained HTML/CSS for the simulated console shell. */
  generated_ui_code: z.string(),
  approved: z.boolean(),
  created_at: z.string(),
  /**
   * The conversation that shaped it, oldest first.
   *
   * Saved with the console so reopening the page resumes the thread rather
   * than starting a fresh argument with a model that cannot see what was
   * already agreed. Defaulted, because consoles approved before the
   * conversation existed have none.
   */
  revisions: z.array(GuiRevisionSchema).default([]),
});
export type GuiTemplate = z.infer<typeof GuiTemplateSchema>;
