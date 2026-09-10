import { z } from "zod";
import { ActionSchema } from "./primitives";
import { TransponderKindSchema } from "./profile";

/* ------------------------------------------------------------------ */
/* Exercise instance — one concrete rendering of a scenario             */
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

export const ExerciseResourceSchema = z.object({
  name: z.string(),
  unit: z.string(),
  available: z.number(),
  total: z.number(),
});

export const ExerciseDilemmaSchema = z.object({
  /** Index into the source scenario's `dilemmas`. Keeps the debrief grounded. */
  kb_dilemma_index: z.number().int(),
  /** The KB situation, rewritten in the concrete terms of this exercise. */
  situation_rendered: z.string(),
  /** Presented in this order; labels must match the KB entry's valid_actions. */
  actions: z.array(ActionSchema),
});
export type ExerciseDilemma = z.infer<typeof ExerciseDilemmaSchema>;

/* ------------------------------------------------------------------ */
/* The live air picture — an exercise that actually runs                */
/* ------------------------------------------------------------------ */

/**
 * A track with motion, rather than a row of pre-rendered numbers.
 *
 * The earlier model stored what the console should *say* about a track —
 * "62 km", "047°" — which is fine for a quiz and useless for a simulation.
 * An operator's job is to watch something close, judge how long they have,
 * and act before it is too late; none of that exists unless the track has a
 * position and a velocity and the clock moves it.
 *
 * So this stores the physical facts and lets the console derive every readout
 * from them at the moment it draws. Range, bearing, time to impact and time
 * to intercept are all computed, never authored, which also means they can
 * never disagree with each other.
 */
export const LiveTrackSchema = z.object({
  /** Shown on the display, e.g. "TK-4471". Invented; never a real call sign. */
  designator: z.string(),
  /**
   * What the track really is — one of the profile's declared classifications,
   * by name. **Never shown directly** where the console can be wrong about it.
   */
  classification: z.string(),
  /**
   * The type the console shows at first, when that is not what the track is.
   *
   * Empty means the system has it right from the start, which is the ordinary
   * case. A different declared class here is a mis-type the operator has to
   * catch — worth setting only on a system whose profile declares the retype
   * command, since otherwise nobody can correct it.
   */
  initial_classification: z.string().default(""),

  /* ---- Where it starts, in polar coordinates about the site ---- */
  /** Bearing from the site when it first appears, 0–360, 0 = north. */
  spawn_bearing_deg: z.number(),
  /** Range from the site when it first appears, in km. */
  spawn_range_km: z.number(),
  /** Altitude in feet. Constant for the run — climbs are not modelled. */
  altitude_ft: z.number(),

  /* ---- Where it is going ---------------------------------------- */
  /** The direction it flies, 0–360. A track attacking the site flies toward it. */
  heading_deg: z.number(),
  /** Ground speed in knots, inside the band its classification declares. */
  speed_kts: z.number(),

  /* ---- Identity: what it is, and what the operator can see ------ */
  /**
   * What the track really is. **Never shown.** Scoring uses it: engaging a
   * track whose truth is friendly is fratricide however it was labelled at
   * the time, and that is exactly the judgement being trained.
   */
  truth_iff: z.string(),
  /** The state it is displayed in when first detected. Often "unknown". */
  initial_iff: z.string(),
  /**
   * When the system resolves it by itself, in seconds from the start, or null
   * if it never does and the operator has to decide without help. A scenario
   * about identification under time pressure lives entirely in this field.
   */
  resolves_at_s: z.number().nullable().default(null),

  /* ---- What its transponder would reply -------------------------- */
  /**
   * This track's transponder, overriding what its class normally carries.
   *
   * `null` — the usual case — means "whatever the classification declares".
   * A value set here is the exception that makes IFF a judgement instead of a
   * lookup, and both directions matter:
   *
   * - **`"none"` on a class that normally replies** is the unserviceable
   *   transponder. A friendly whose box has failed answers nothing, and the
   *   operator who treats silence as proof of hostility commits fratricide.
   * - **`"civil"` on a hostile** is the stolen or spoofed code. It replies,
   *   and the reply is a lie — which is the whole reason a Mode 3 code alone
   *   was never identification.
   *
   * Without this the two are inexpressible: every track of a class answered
   * identically, so interrogating told the operator the class they could
   * already see.
   */
  transponder: TransponderKindSchema.nullable().default(null),
  /**
   * Mode 3/A code: four octal digits, or `""` for a track that does not reply.
   *
   * Never shown until the operator interrogates. Silence is a legitimate and
   * deliberate answer — it is most of what makes an unknown track a decision
   * rather than a lookup.
   */
  mode_3: z.string().default(""),
  /** Mode 1 code: two digits 0–4, or `""`. Military transponders only. */
  mode_1: z.string().default(""),

  /** Seconds from the start before it appears. 0 means it is up from the off. */
  appears_at_s: z.number().default(0),
  /** Anything that makes this track notable or ambiguous. */
  notes: z.string().default(""),
});
export type LiveTrack = z.infer<typeof LiveTrackSchema>;

/**
 * What the run is judged on.
 *
 * Deliberately a short list of hard, countable outcomes rather than free-form
 * goals: a trainee should be able to read this before the clock starts and
 * know exactly what winning means, and the grader should not have to interpret
 * anything. Judgement about *how* they got there is the debrief's job, and it
 * has the whole event log to work from.
 */
export const SuccessCriteriaSchema = z.object({
  /** Hostile tracks allowed to reach the defended area. Usually 0. */
  max_leakers: z.number().int().default(0),
  /** Interceptors the operator may spend and still be judged efficient. */
  max_interceptors_spent: z.number().int().default(99),
  /** What success means here, in one sentence, for the trainee to read. */
  statement: z.string().default(""),
});
export type SuccessCriteria = z.infer<typeof SuccessCriteriaSchema>;

/**
 * One thing that happened during a run.
 *
 * This is the record the debrief is built from, and it replaces the old list
 * of chosen answers. It says what the operator did, when, and what came of it
 * — including the commands the system refused, because being told "inside
 * minimum range" at the wrong moment is a lesson, not an error to hide.
 */
export const SimEventSchema = z.object({
  /** Seconds from the start of the run. */
  t: z.number(),
  kind: z.enum([
    "detected",
    "resolved",
    "classified",
    "retyped",
    "interrogated",
    "launched",
    "refused",
    "hit",
    "miss",
    "leaked",
    "ceased",
    "reloaded",
    "tilted",
    "ended",
  ]),
  /** The track it concerns, where it concerns one. */
  designator: z.string().default(""),
  /** One line, already written for a human to read in the debrief. */
  detail: z.string(),
});
export type SimEvent = z.infer<typeof SimEventSchema>;

/** What the run added up to. Counted by the engine, never by the model. */
export const RunResultSchema = z.object({
  leakers: z.number().int(),
  hostiles_destroyed: z.number().int(),
  /**
   * Hostiles still in the air when the run stopped.
   *
   * Neither destroyed nor arrived, and therefore invisible in both of the
   * counts either side of this line — which stopped being harmless the moment
   * an operator could end a run themselves. Ending one eight seconds in, with
   * three jets inbound, satisfied every criterion by having done nothing.
   * Defaulted, because runs recorded before this field existed could only end
   * on the clock and were not scored against it.
   */
  hostiles_unresolved: z.number().int().default(0),
  friendly_engaged: z.number().int(),
  unknown_engaged: z.number().int(),
  interceptors_spent: z.number().int(),
  /**
   * Rounds spent, per round type. Keyed by `InterceptorType.name`.
   *
   * The total above cannot answer the question a debrief most wants to ask of
   * a system with several rounds: not "did they spend too many" but "did they
   * spend the wrong ones". Four rounds against four hostiles is efficient
   * until it turns out all four were the long-range round and the last track
   * came in high. Empty on runs recorded before rounds had their own stock.
   */
  spent_by: z.record(z.string(), z.number().int()).default({}),
  /** Seconds from a hostile being resolvable to the operator engaging it. */
  mean_reaction_s: z.number().nullable(),
  met_criteria: z.boolean(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export const ExerciseInstanceSchema = z.object({
  exercise_name: z.string(),
  /** The brief the trainee reads before the clock starts. */
  situation_brief: z.string(),
  time_window_seconds: z.number(),
  resources: z.array(ExerciseResourceSchema),

  /**
   * The air picture that actually runs. Everything a trainee sees on the scope
   * comes from here, moved by the clock.
   */
  live_tracks: z.array(LiveTrackSchema).default([]),
  /**
   * Which way a fixed radar array is facing, 0–360.
   *
   * Meaningless for a rotating radar and ignored there. For a sector array it
   * decides which threats are seen early and which arrive through the blind
   * arc, so the generator places it deliberately — it belongs to the exercise
   * rather than the profile because the same battery can be sited facing any
   * direction, and where it faces is part of the problem being set.
   */
  radar_boresight_deg: z.number().default(0),

  /**
   * How many of each round the trainee starts this run with.
   *
   * Separate from the profile's `magazine_max` because they answer different
   * questions. The profile says what the system *can* carry — hardware, asked
   * once. This says what it *is* carrying today, which is a training choice
   * and the sharpest one available: four hostiles and three long-range rounds
   * is a different exercise from the same four with a full load, using the
   * same scenario and the same system.
   *
   * Empty means a full load of everything the profile declares. Names match
   * the profile's rounds; anything else is dropped, and anything above the
   * declared maximum is clamped, because a run cannot issue rounds the
   * system cannot hold.
   */
  interceptor_loadout: z
    .array(
      z.object({
        /** Matches `InterceptorType.name`. */
        name: z.string(),
        rounds: z.number().int(),
      }),
    )
    .default([]),

  success_criteria: SuccessCriteriaSchema.default({
    max_leakers: 0,
    max_interceptors_spent: 99,
    statement: "",
  }),

  /**
   * The earlier shape: a static picture and a set of multiple-choice prompts.
   *
   * Kept only so runs recorded before the simulator existed still open. Nothing
   * new is written here — an exercise now carries `live_tracks` instead, and a
   * trainee flies the engagement rather than answering questions about it.
   */
  tracks: z.array(TrackSchema).default([]),
  dilemmas: z.array(ExerciseDilemmaSchema).default([]),
});
export type ExerciseInstance = z.infer<typeof ExerciseInstanceSchema>;
