import { z } from "zod";

/**
 * Domain model for the air-defence training simulator.
 *
 * Every schema here does double duty: it validates data on the way in and out of
 * storage, AND it is handed to Claude as a structured-output format. Keeping one
 * definition avoids the classic drift where the prompt and the parser disagree.
 *
 * Note on strictness: structured outputs require closed objects (no additional
 * properties) and explicit `required` lists, so every field below is mandatory.
 * Where a value may legitimately be unknown, the field is a string that the
 * model fills with an explicit "unknown"/"n/a" rather than an optional.
 */

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

/* ------------------------------------------------------------------ */
/* Dilemma entry — the core of the knowledge base                      */
/* ------------------------------------------------------------------ */

export const KeyVariablesSchema = z.object({
  threat_count_range: RangeSchema,
  time_window_seconds: RangeSchema,
  /** Ordered from least to most certain, e.g. ["unknown","assumed hostile","confirmed hostile"] */
  iff_certainty_levels: z.array(z.string()),
  resource_levels: z.array(ResourceLevelSchema),
});
export type KeyVariables = z.infer<typeof KeyVariablesSchema>;

export const DecisionPointSchema = z.object({
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
export type DecisionPoint = z.infer<typeof DecisionPointSchema>;

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
 * The part of a dilemma entry that Claude extracts from the designer's chat.
 * Excludes identity, status and provenance, which the server owns.
 */
export const DilemmaDraftSchema = z.object({
  title: z.string(),
  /** Kebab-case tag, e.g. "multi-threat-prioritization". */
  sub_domain_tag: z.string(),
  /** Free text describing when this dilemma is the right match for a request. */
  trigger_conditions: z.string(),
  key_variables: KeyVariablesSchema,
  decision_points: z.array(DecisionPointSchema),
  difficulty_scaling: DifficultyScalingSchema,
  evaluation_criteria: EvaluationCriteriaSchema,
});
export type DilemmaDraft = z.infer<typeof DilemmaDraftSchema>;

export const DilemmaStatusSchema = z.enum(["draft", "approved"]);
export type DilemmaStatus = z.infer<typeof DilemmaStatusSchema>;

export const DilemmaEntrySchema = DilemmaDraftSchema.extend({
  id: z.string(),
  status: DilemmaStatusSchema,
  /** Transcript of the learning conversation this entry was extracted from. */
  source_chat_log: z.string(),
  created_at: z.string(),
  approved_at: z.string().nullable(),
});
export type DilemmaEntry = z.infer<typeof DilemmaEntrySchema>;

/* ------------------------------------------------------------------ */
/* Simulated system GUI                                                */
/* ------------------------------------------------------------------ */

export const GuiTemplateSchema = z.object({
  id: z.string(),
  system_name_fictional: z.string(),
  /** Repo-relative paths of the uploaded reference screenshots. */
  source_screenshots: z.array(z.string()),
  /** Self-contained HTML/CSS for the simulated console shell. */
  generated_ui_code: z.string(),
  approved: z.boolean(),
  created_at: z.string(),
});
export type GuiTemplate = z.infer<typeof GuiTemplateSchema>;

/* ------------------------------------------------------------------ */
/* Scenario instance — one concrete rendering of a dilemma             */
/* ------------------------------------------------------------------ */

export const TrackSchema = z.object({
  /** Short track designator shown on the display, e.g. "TK-4471". */
  designator: z.string(),
  /** One of the dilemma's `iff_certainty_levels`. */
  iff_status: z.string(),
  classification: z.string(),
  bearing_deg: z.number(),
  range_km: z.number(),
  altitude_ft: z.number(),
  speed_kts: z.number(),
  heading_deg: z.number(),
  time_to_impact_seconds: z.number(),
  /** Anything that makes this track ambiguous or notable. */
  notes: z.string(),
});
export type Track = z.infer<typeof TrackSchema>;

export const ScenarioResourceSchema = z.object({
  name: z.string(),
  unit: z.string(),
  available: z.number(),
  total: z.number(),
});

export const ScenarioDecisionPointSchema = z.object({
  /** Index into the source dilemma's `decision_points`. Keeps the debrief grounded. */
  kb_decision_point_index: z.number().int(),
  /** The KB situation, rewritten in the concrete terms of this scenario. */
  situation_rendered: z.string(),
  /** Presented in this order; labels must match the KB entry's valid_actions. */
  actions: z.array(ActionSchema),
});
export type ScenarioDecisionPoint = z.infer<typeof ScenarioDecisionPointSchema>;

export const ScenarioInstanceSchema = z.object({
  scenario_name: z.string(),
  /** The brief the trainee reads before the clock starts. */
  situation_brief: z.string(),
  time_window_seconds: z.number(),
  tracks: z.array(TrackSchema),
  resources: z.array(ScenarioResourceSchema),
  decision_points: z.array(ScenarioDecisionPointSchema),
});
export type ScenarioInstance = z.infer<typeof ScenarioInstanceSchema>;

/* ------------------------------------------------------------------ */
/* Matching engine                                                     */
/* ------------------------------------------------------------------ */

export const MatchResultSchema = z.object({
  /** Id of the best-matching approved dilemma, or "" if nothing fits at all. */
  dilemma_entry_id: z.string(),
  /** 0.0 - 1.0. Below the clarification threshold triggers a follow-up question. */
  confidence: z.number(),
  /** One sentence: why this dilemma matches the request. */
  reasoning: z.string(),
  /** Populated only when confidence is low; "" otherwise. */
  clarifying_question: z.string(),
  /** Difficulty inferred from the request's wording. */
  suggested_difficulty: z.enum(["easy", "medium", "hard"]),
});
export type MatchResult = z.infer<typeof MatchResultSchema>;

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export const DifficultyLevelSchema = z.enum(["easy", "medium", "hard"]);
export type DifficultyLevel = z.infer<typeof DifficultyLevelSchema>;

export const ClarificationRoundSchema = z.object({
  question: z.string(),
  answer: z.string(),
});
export type ClarificationRound = z.infer<typeof ClarificationRoundSchema>;

export const DecisionMadeSchema = z.object({
  decision_point_index: z.number().int(),
  chosen_action: z.string(),
  /** Milliseconds from when the decision point was shown to when it was answered. */
  elapsed_ms: z.number(),
});
export type DecisionMade = z.infer<typeof DecisionMadeSchema>;

export const OutcomeSchema = z.object({
  success: z.boolean(),
  /** Which parts of the success condition were met, and which were not. */
  summary: z.string(),
  per_decision: z.array(
    z.object({
      decision_point_index: z.number().int(),
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
  dilemma_entry_id: z.string(),
  requested_text: z.string(),
  clarification_rounds: z.array(ClarificationRoundSchema),
  difficulty_level: DifficultyLevelSchema,
  scenario_instance: ScenarioInstanceSchema,
  decisions_made: z.array(DecisionMadeSchema),
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
