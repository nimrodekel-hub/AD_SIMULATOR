import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Simulated systems                                                   */
/* ------------------------------------------------------------------ */

/**
 * One simulated system the app can train on. Several exist side by side.
 *
 * A system is the container for everything that only makes sense inside it:
 * how it behaves, what its console looks like, and which scenarios were taught
 * within it. It exists as soon as it is named, so it can be listed and worked
 * on before the profile has been extracted or the console built.
 *
 * The name is the *fictional* system name, given by the designer rather than
 * invented by the model. It is the one name used everywhere — in the UI, in
 * the console, and in every prompt — so there is nothing to drift out of sync.
 */
export const SimulatedSystemSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** One line for the designer's own benefit when several systems are listed. */
  note: z.string(),
  created_at: z.string(),
});
export type SimulatedSystem = z.infer<typeof SimulatedSystemSchema>;
