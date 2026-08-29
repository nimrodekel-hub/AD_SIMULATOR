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
  /** The simulated system this dilemma was taught inside. */
  system_id: z.string(),
  status: DilemmaStatusSchema,
  /** Transcript of the learning conversation this entry was extracted from. */
  source_chat_log: z.string(),
  created_at: z.string(),
  approved_at: z.string().nullable(),
});
export type DilemmaEntry = z.infer<typeof DilemmaEntrySchema>;

/* ------------------------------------------------------------------ */
/* Simulated systems                                                   */
/* ------------------------------------------------------------------ */

/**
 * One simulated system the app can train on. Several exist side by side.
 *
 * A system is the container for everything that only makes sense inside it:
 * how it behaves, what its console looks like, and which dilemmas were taught
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

/* ------------------------------------------------------------------ */
/* System profile — how the simulated system actually behaves          */
/* ------------------------------------------------------------------ */

/**
 * Taught once per system, before any of its dilemmas, and injected into every
 * scenario and debrief afterwards.
 *
 * Without it the model invents a system: it guesses what classifications exist,
 * what makes a track hostile, and what an operator can do. The scenarios then
 * look right and are not right. This record replaces those guesses with the
 * designer's own doctrine.
 */

export const TrackClassificationSchema = z.object({
  name: z.string(),
  description: z.string(),
  typical_speed_kts: RangeSchema,
  typical_altitude_ft: RangeSchema,
  /** How this kind of track behaves on its way to a target. */
  behaviour_note: z.string(),
});
export type TrackClassification = z.infer<typeof TrackClassificationSchema>;

export const IffStateSchema = z.object({
  name: z.string(),
  meaning: z.string(),
  /** What has to happen for a track to be in this state. */
  how_determined: z.string(),
  /** Drives the colour the console shows it in, using the status palette. */
  tone: z.enum(["friendly", "neutral", "caution", "hostile"]),
});
export type IffState = z.infer<typeof IffStateSchema>;

export const TrackReadoutFieldSchema = z.object({
  /** Column header as the real console shows it, e.g. "RNG". */
  label: z.string(),
  unit: z.string(),
  description: z.string(),
});
export type TrackReadoutField = z.infer<typeof TrackReadoutFieldSchema>;

/**
 * What the system can see, which is a different question from what it can hit.
 *
 * Detection decides how much warning an operator gets, and therefore the clock
 * on every dilemma about time. Coverage decides whether they get any warning at
 * all from a given direction: a rotating radar sees all round, a fixed array
 * watches a sector and is blind behind it, and a threat arriving through the
 * gap is a completely different training problem.
 *
 * Every field is nullable, because a designer may know the detection range
 * without knowing the altitude ceiling, and a half-filled sensor section is
 * more useful than an empty one. Profiles approved before this section existed
 * carry none of it and must keep loading.
 */
export const SensorCoverageSchema = z.object({
  /** How far out it detects. Not the engagement range. */
  max_range_km: z.number().nullable().default(null),
  /** A close-in blind zone, where there is one. */
  min_range_km: z.number().nullable().default(null),
  /** 360 for a rotating radar; 120 for a fixed sector, and so on. */
  azimuth_coverage_deg: z.number().nullable().default(null),
  /** The altitude band it can see, in feet. */
  altitude_ft: RangeSchema.nullable().default(null),
  /** Terrain shadows, arcs, anything the numbers do not carry. */
  note: z.string().default(""),
});
export type SensorCoverage = z.infer<typeof SensorCoverageSchema>;

export const EngagementDoctrineSchema = z.object({
  /** The closest a target can be and still be engaged. */
  min_range_km: z.number(),
  /** The furthest a target can be and still be engaged. */
  max_range_km: z.number(),
  time_of_flight_note: z.string(),
  /** How many interceptors may be in the air at once. Per system. */
  simultaneous_engagements_note: z.string(),
  /** Who may authorise an engagement, and when that changes. */
  authority_note: z.string(),
});
export type EngagementDoctrine = z.infer<typeof EngagementDoctrineSchema>;

/**
 * The part the model extracts from the designer's answers.
 *
 * The system's name is not in here: the designer gives it when they create the
 * system, and it is not the model's to invent or change.
 */
export const SystemProfileDraftSchema = z.object({
  /** What the system defends, and against what. */
  purpose: z.string(),
  track_classifications: z.array(TrackClassificationSchema),
  iff_states: z.array(IffStateSchema),
  /** The columns the console shows for every track, in display order. */
  track_readout_fields: z.array(TrackReadoutFieldSchema),
  /** What the radar sees, and from where. */
  sensor: SensorCoverageSchema.default({
    max_range_km: null,
    min_range_km: null,
    azimuth_coverage_deg: null,
    altitude_ft: null,
    note: "",
  }),
  engagement: EngagementDoctrineSchema,
  /** What the operator decides. */
  operator_responsibilities: z.array(z.string()),
  /** What the system does without being asked. */
  automatic_functions: z.array(z.string()),
  /** The order actions are actually performed in. */
  workflow_steps: z.array(z.string()),
  /** Anything else worth knowing that the questions did not ask about. */
  general_notes: z.string(),
});
export type SystemProfileDraft = z.infer<typeof SystemProfileDraftSchema>;

export const SystemProfileSchema = SystemProfileDraftSchema.extend({
  /** Same value as the system's id — one profile per system. */
  id: z.string(),
  approved: z.boolean(),
  /** The designer's raw answers, kept so the extraction can be audited. */
  source_answers: z.array(
    z.object({ question: z.string(), answer: z.string() }),
  ),
  created_at: z.string(),
  approved_at: z.string().nullable(),
});
export type SystemProfile = z.infer<typeof SystemProfileSchema>;

/* ------------------------------------------------------------------ */
/* Simulated system GUI                                                */
/* ------------------------------------------------------------------ */

export const GuiTemplateSchema = z.object({
  /** Same value as the system's id — one console per system. */
  id: z.string(),
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

/**
 * One readout on a track, e.g. { label: "RNG", value: "62 km" }.
 *
 * The columns are not fixed by this code: they come from the system profile the
 * designer taught, so the console shows the fields their system actually shows.
 */
export const TrackReadoutSchema = z.object({
  label: z.string(),
  value: z.string(),
});
export type TrackReadout = z.infer<typeof TrackReadoutSchema>;

export const TrackSchema = z.object({
  /** Short track designator shown on the display, e.g. "TK-4471". */
  designator: z.string(),
  /** One of the system profile's declared identification states. */
  iff_status: z.string(),
  /** One of the system profile's declared track classifications. */
  classification: z.string(),
  /** One entry per readout field the profile declares, in that order. */
  readouts: z.array(TrackReadoutSchema),
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
  /** Which simulated system this run was on. Fixed at creation: the console
      and the profile it renders with must not change under a finished run. */
  system_id: z.string(),
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

/**
 * The half of the profile a model is still useful for.
 *
 * Everything measurable — sensor coverage, track classes and their bands, the
 * readout columns, the engagement envelope — is now entered directly by the
 * designer, because a number typed into a box cannot be misread and costs
 * nothing to produce. What is left is the prose: what the system is for, what
 * the operator decides, what happens without them, and in what order.
 *
 * That is the part where a model earns its place, turning a paragraph into
 * tidy lists without changing what it says.
 */
export const SystemNarrativeSchema = z.object({
  purpose: z.string(),
  operator_responsibilities: z.array(z.string()),
  automatic_functions: z.array(z.string()),
  workflow_steps: z.array(z.string()),
  general_notes: z.string(),
});
export type SystemNarrative = z.infer<typeof SystemNarrativeSchema>;

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
