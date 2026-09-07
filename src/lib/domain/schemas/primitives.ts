import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export const RangeSchema = z.object({
  min: z.number(),
  max: z.number(),
});
export type Range = z.infer<typeof RangeSchema>;

export const ResourceLevelSchema = z.object({
  /** e.g. "interceptors", "launchers", "engagement channels" */
  name: z.string(),
  unit: z.string(),
  min: z.number(),
  max: z.number(),
});

export const ActionSchema = z.object({
  /** Short label shown on the action button in the trainee UI. */
  label: z.string(),
  /** One sentence explaining what this action does operationally. */
  description: z.string(),
});
export type Action = z.infer<typeof ActionSchema>;
