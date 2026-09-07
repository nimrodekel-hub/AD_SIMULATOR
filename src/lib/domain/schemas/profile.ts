import { z } from "zod";
import { RangeSchema } from "./primitives";

/* ------------------------------------------------------------------ */
/* System profile — how the simulated system actually behaves          */
/* ------------------------------------------------------------------ */

/**
 * Taught once per system, before any of its scenarios, and injected into every
 * exercise and debrief afterwards.
 *
 * Without it the model invents a system: it guesses what classifications exist,
 * what makes a track hostile, and what an operator can do. The exercises then
 * look right and are not right. This record replaces those guesses with the
 * designer's own doctrine.
 */

/**
 * What a track's transponder answers when it is interrogated.
 *
 * `none` is not an omission — it is the interesting case. A track that does
 * not reply is the one an operator has to decide about, and a system whose
 * every class replies has removed the scenario rather than modelled it.
 *
 * `civil` carries a Mode 3/A code only. `military` carries Mode 1 as well,
 * which is what distinguishes a co-operating military aircraft from an
 * airliner squawking a code an air-traffic centre assigned it.
 */
export const TransponderKindSchema = z.enum(["none", "civil", "military"]);
export type TransponderKind = z.infer<typeof TransponderKindSchema>;

export const TrackClassificationSchema = z.object({
  name: z.string(),
  description: z.string(),
  typical_speed_kts: RangeSchema,
  typical_altitude_ft: RangeSchema,
  /** How this kind of track behaves on its way to a target. */
  behaviour_note: z.string(),
  /**
   * Whether this class carries a transponder, and which modes it answers on.
   *
   * Defaulted to `none` so a profile written before interrogation existed
   * keeps loading — and reads honestly, since such a profile never said any
   * class replies.
   */
  transponder: TransponderKindSchema.default("none"),
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

/**
 * Whether the system can interrogate a transponder, and on which modes.
 *
 * A separate capability from the radar: plenty of systems see a track without
 * being able to ask it anything, and an operator on such a system identifies
 * by behaviour alone. That is a different training problem, and it is the
 * designer's to declare rather than the app's to assume — so this defaults to
 * off, and every profile approved before it existed reads as off.
 *
 * **Mode 3/A** is four octal digits (each 0–7): the code civil air traffic
 * assigns, and the one a co-operating military aircraft also squawks.
 * **Mode 1** is two digits (each 0–4): a military mission code, so a reply on
 * it says more than a Mode 3 code alone does.
 */
export const IffInterrogationSchema = z.object({
  /** Off means the console has no interrogate command at all. */
  enabled: z.boolean().default(false),
  /** Four octal digits. The mode almost every interrogator has. */
  mode_3: z.boolean().default(true),
  /** Two digits 0–4. Military only. */
  mode_1: z.boolean().default(false),
  /** Anything the numbers do not carry — who may interrogate, when, delays. */
  note: z.string().default(""),
});
export type IffInterrogation = z.infer<typeof IffInterrogationSchema>;

export const IFF_INTERROGATION_OFF: IffInterrogation = {
  enabled: false,
  mode_3: true,
  mode_1: false,
  note: "",
};

/**
 * The commands this system's console offers beyond the four every system has.
 *
 * Selecting, identifying, firing and ceasing exist everywhere and are not
 * declared. Everything here is a capability some systems have and others do
 * not, and each one is a real rule in the engine rather than a button: a
 * reload that costs no time would teach an operator that reloading is free,
 * which is the opposite of the lesson.
 *
 * **Why this exists at all.** `operator_responsibilities` already asked the
 * designer what the operator decides — and it is prose, so it could only ever
 * be *described*. A profile could declare "chooses which launcher to fire
 * from" and the simulator had no idea; the answer was recorded, shown to the
 * console builder, and silently unusable. Declaring a capability and being
 * unable to act on it is the same failure as an empty IFF column: the screen
 * asks a question it cannot honour.
 *
 * Everything defaults to off, so a profile written before this existed loads
 * with exactly the console it had.
 */
export const OperatorCommandsSchema = z.object({
  /**
   * The operator may correct the track type the console shows.
   *
   * Only worth having where the system's own typing can be wrong — the
   * exercise decides that per track, with `initial_classification`.
   */
  retype: z.boolean().default(false),

  /** The magazine can be refilled during a run. */
  reload: z.boolean().default(false),
  /**
   * How long a reload takes, in seconds. The clock does not stop for it, and
   * that is the whole point: reloading costs the time the next track is using
   * to close.
   */
  reload_seconds: z.number().nullable().default(null),

  /** More than one launcher, and the operator picks which one fires. */
  launchers: z.boolean().default(false),
  /**
   * How many launchers there are. The magazine is divided between them, so
   * turning this on adds a decision without adding rounds — a launcher that
   * is empty, reloading or already committed cannot fire.
   */
  launcher_count: z.number().int().nullable().default(null),

  /** A fixed array whose elevation the operator sets during the run. */
  tilt: z.boolean().default(false),
  /** The lowest elevation the array can be pointed at, in degrees. */
  tilt_min_deg: z.number().nullable().default(null),
  /** The highest. A track below where the array points is not held. */
  tilt_max_deg: z.number().nullable().default(null),

  /** Anything the switches do not carry. */
  note: z.string().default(""),
});
export type OperatorCommands = z.infer<typeof OperatorCommandsSchema>;

/** Every extra command off: the four universal ones, and nothing else. */
export const OPERATOR_COMMANDS_OFF: OperatorCommands = {
  retype: false,
  reload: false,
  reload_seconds: null,
  launchers: false,
  launcher_count: null,
  tilt: false,
  tilt_min_deg: null,
  tilt_max_deg: null,
  note: "",
};

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
 * on every scenario about time. Coverage decides whether they get any warning at
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

/**
 * One kind of interceptor the system shoots.
 *
 * Systems that carry more than one round have an operator decision built into
 * the choice — a long-range round spent on a close target is a round that is
 * not there for the next one — so this is a list rather than a single set of
 * figures. A system with one round type declares one entry, and nothing about
 * the simulation changes.
 */
export const InterceptorTypeSchema = z.object({
  /** As the console labels it, e.g. "long range". */
  name: z.string(),
  min_range_km: z.number(),
  max_range_km: z.number(),
  /** Average speed over the flight, in knots. Sets the time of flight. */
  speed_kts: z.number(),
  /**
   * The most of this round the system can carry, as a matter of hardware.
   *
   * Stock is per round, not one pool. A battery does not hold "eight
   * interceptors" — it holds four long-range and four short-range, and the
   * operator who spends both long-range rounds early cannot reach the next
   * high mover however many short-range rounds are left. A single counter
   * made choosing a round free, which is the opposite of the decision the
   * several rounds exist to create.
   *
   * This is the ceiling the system has, asked once in the profile. How many
   * a given run actually starts with is the exercise's to say, and never more
   * than this.
   */
  magazine_max: z.number().int().nullable().default(null),
});
export type InterceptorType = z.infer<typeof InterceptorTypeSchema>;

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

  /* ---- The figures the simulation needs to actually run --------- */
  /**
   * These three used to live inside the prose above, which was fine while a
   * run was a quiz and useless once it became a simulation: "no more than two
   * rockets in the air" has to be a number before anything can enforce it.
   * All nullable, because a profile written before the simulator existed has
   * none of them and must keep working — the engine falls back to a plain
   * single-round model when they are missing.
   */
  interceptors: z.array(InterceptorTypeSchema).default([]),
  /** Interceptors that may be in the air at the same time. */
  max_simultaneous: z.number().int().nullable().default(null),
  /**
   * The old single pool, kept only so records written before rounds had
   * their own magazines still load and still run.
   *
   * Stock is declared per interceptor now (`InterceptorType.magazine_max`).
   * Where a record has none of those and does have this, the engine shares
   * this total out across the declared rounds rather than inventing a
   * figure — documented in `docs/interceptor-stock.md`. Nothing asks for it
   * any more, and a profile that still relies on it is told so.
   */
  magazine_depth: z.number().int().nullable().default(null),
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
  /** Whether the system can interrogate a transponder, and on which modes. */
  iff_interrogation: IffInterrogationSchema.default(IFF_INTERROGATION_OFF),
  /**
   * The commands this console offers beyond selecting, identifying, firing
   * and ceasing. Each one the engine implements and the profile switches on.
   */
  operator_commands: OperatorCommandsSchema.default(OPERATOR_COMMANDS_OFF),
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
