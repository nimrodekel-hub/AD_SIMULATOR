import { z } from "zod";
import { ActionSchema, RangeSchema, ResourceLevelSchema } from "./primitives";

/* ------------------------------------------------------------------ */
/* Scenario entry — the core of the knowledge base                      */
/* ------------------------------------------------------------------ */

export const KeyVariablesSchema = z.object({
  threat_count_range: RangeSchema,
  time_window_seconds: RangeSchema,
  /** Ordered from least to most certain, e.g. ["unknown","assumed hostile","confirmed hostile"] */
  iff_certainty_levels: z.array(z.string()),
  resource_levels: z.array(ResourceLevelSchema),
});
export type KeyVariables = z.infer<typeof KeyVariablesSchema>;

export const DilemmaSchema = z.object({
  /** The situation the trainee faces at this branch point. */
  situation: z.string(),
  valid_actions: z.array(ActionSchema),
  /** Must exactly match one of the `valid_actions[].label` values. */
  preferred_action: z.string(),
  /** Why the preferred action is preferred. Used verbatim as debrief grounding. */
  rationale: z.string(),
  /** Mistakes trainees typically make here, and why each is tempting. */
  common_errors: z.array(z.string()),
});
export type Dilemma = z.infer<typeof DilemmaSchema>;

export const DifficultyBandSchema = z.object({
  description: z.string(),
  threat_count: RangeSchema,
  time_window_seconds: RangeSchema,
  /** How IFF ambiguity and resource pressure shift at this level. */
  pressure_note: z.string(),
});

export const DifficultyScalingSchema = z.object({
  easy: DifficultyBandSchema,
  medium: DifficultyBandSchema,
  hard: DifficultyBandSchema,
});
export type DifficultyScaling = z.infer<typeof DifficultyScalingSchema>;

export const EvaluationCriteriaSchema = z.object({
  /** Objectively checkable statement of what counts as mission success. */
  success_condition: z.string(),
  /** How to weight partial credit, and what separates a 60 from a 90. */
  scoring_notes: z.string(),
});
export type EvaluationCriteria = z.infer<typeof EvaluationCriteriaSchema>;

/**
 * The part of a scenario entry that Claude extracts from the designer's chat.
 * Excludes identity, status and provenance, which the server owns.
 */
export const ScenarioDraftSchema = z.object({
  title: z.string(),
  /** Kebab-case tag, e.g. "multi-threat-prioritization". */
  sub_domain_tag: z.string(),
  /** Free text describing when this scenario is the right match for a request. */
  trigger_conditions: z.string(),
  key_variables: KeyVariablesSchema,
  dilemmas: z.array(DilemmaSchema),
  difficulty_scaling: DifficultyScalingSchema,
  evaluation_criteria: EvaluationCriteriaSchema,
});
export type ScenarioDraft = z.infer<typeof ScenarioDraftSchema>;

export const ScenarioStatusSchema = z.enum(["draft", "approved"]);
export type ScenarioStatus = z.infer<typeof ScenarioStatusSchema>;

export const ScenarioEntrySchema = ScenarioDraftSchema.extend({
  id: z.string(),
  /** The simulated system this scenario was taught inside. */
  system_id: z.string(),
  status: ScenarioStatusSchema,
  /** Transcript of the learning conversation this entry was extracted from. */
  source_chat_log: z.string(),
  created_at: z.string(),
  approved_at: z.string().nullable(),
});
export type ScenarioEntry = z.infer<typeof ScenarioEntrySchema>;
