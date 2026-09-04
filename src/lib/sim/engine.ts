import type {
  IffState,
  LiveTrack,
  RunResult,
  ExerciseInstance,
  SimEvent,
  SuccessCriteria,
  SystemProfile,
  TrackReadoutField,
} from "../domain/schemas";
import { describeReply, meaningOfMode3 } from "../domain/iff-codes";
import {
  add,
  elevationDeg,
  polarToVec,
  scale,
  timeToImpact,
  timeToIntercept,
  vecToPolar,
  velocity,
  withinArc,
  type Vec,
} from "./geometry";

/**
 * The simulation: what is where, what the operator did, and what came of it.
 *
 * This is deliberately a pure state machine. `step` and `command` take a state
 * and return a new one; nothing here reads a clock, touches the DOM, or calls
 * a model. The browser owns the tick and the drawing, and can be replaced
 * without any of the rules changing — and the rules can be tested by hand,
 * which matters, because a training system that computes an intercept wrongly
 * teaches the wrong lesson with total confidence.
 *
 * Two decisions are worth knowing about before reading the rest:
 *
 *   - **A refused command is an event, not an error.** Firing inside minimum
 *     range, or with everything already committed, is exactly the mistake the
 *     exercise exists to surface. The engine says no *and says why*, the
 *     refusal goes in the log, and the debrief can talk about it.
 *   - **Hit or miss is decided when the round is launched**, from a seeded
 *     draw, and only revealed on impact. That keeps a run replayable and keeps
 *     two trainees on the same exercise facing the same luck.
 */

/* ------------------------------------------------------------------ */
/* What the engine needs to know about the system it is simulating     */
/* ------------------------------------------------------------------ */

export interface InterceptorSpec {
  name: string;
  min_range_km: number;
  max_range_km: number;
  speed_kts: number;
}

export interface SimConfig {
  /** How far the radar sees. Beyond this, nothing is on the scope. */
  detection_range_km: number;
  /** A close-in blind zone, where a track vanishes as it closes. */
  blind_range_km: number;
  /** 360 for a rotating radar; less for a fixed array. */
  coverage_deg: number;
  /** The centre of the covered arc. Meaningless when coverage is 360. */
  boresight_deg: number;
  /** The altitude band the radar sees, or null for no stated limit. */
  altitude_ft: { min: number; max: number } | null;

  /** Rounds the operator can choose between. Never empty — see `simConfig`. */
  interceptors: InterceptorSpec[];
  /** How many may be in the air at once. */
  max_simultaneous: number;
  /** How many rounds exist for the whole run. */
  magazine: number;

  /**
   * The columns the console shows for each track, in the designer's order.
   *
   * These were declared in the profile and read by nothing that a trainee
   * ever saw: the console shell was told to lay out space for them, and the
   * live track table then drew a fixed set of its own into that space. So a
   * designer could tick IFF, altitude, fire status — and watch none of it
   * appear, with no way to tell whether the column was ignored or the value
   * was missing. The table is built from this now.
   */
  readouts: TrackReadoutField[];

  /**
   * The track classes the console can show, in the designer's order.
   *
   * Only read where the operator may retype a track: they are the choices
   * offered, and offering a class the profile never declared would be the
   * console inventing one.
   */
  classes: string[];

  /** Inside this radius a hostile has arrived, and the run has lost one. */
  defended_radius_km: number;
  /** Identification state name (lower-cased) to the tone the designer gave it. */
  tones: Record<string, IffState["tone"]>;

  /**
   * Whether this system can interrogate a transponder, and on which modes.
   *
   * Off means the console has no interrogate command: an operator on such a
   * system identifies by behaviour, which is a different skill and a
   * deliberate one to train.
   */
  iff: { enabled: boolean; mode_3: boolean; mode_1: boolean };

  /**
   * The commands this console offers beyond the four every system has.
   *
   * Selecting, identifying, firing and ceasing are universal and not
   * declared. The rest are capabilities a profile switches on, and each is a
   * rule here rather than a button in the console: the console can only draw
   * what this says exists, so a system that cannot reload has no reload —
   * not a button that quietly does nothing.
   */
  commands: {
    /** The operator may correct the type the console shows for a track. */
    retype: boolean;
    /** Refilling a launcher, and what it costs in seconds of the run. */
    reload: { enabled: boolean; seconds: number };
    /** How many launchers there are. One when the command is not declared. */
    launchers: number;
    /** A fixed array whose elevation the operator sets during the run. */
    tilt: { enabled: boolean; min_deg: number; max_deg: number };
  };
}

/** The state a track is in, which is not the same as how it is identified. */
export type TrackState =
  | "pending"
  | "airborne"
  | "destroyed"
  | "leaked"
  | "departed";

export interface RuntimeTrack {
  designator: string;
  /** What it really is. Scoring and the debrief read this. */
  classification: string;
  /**
   * The type the console currently shows, which the operator may have set.
   *
   * Separate from the truth for the same reason `displayed_iff` is: a system
   * that can be wrong about what it is looking at, and an operator who can
   * correct it, is a different exercise from one where the label is handed
   * down. On a system without the retype command the two never diverge.
   */
  displayed_classification: string;
  /** True once a person changed it, so nothing overrides them afterwards. */
  typed_by_operator: boolean;
  altitude_ft: number;
  speed_kts: number;
  heading_deg: number;
  notes: string;

  /** Where it was when it appeared, and how it moves. Never changes. */
  spawn: Vec;
  velocity: Vec;
  appears_at_s: number;

  /** What it really is. Scoring reads this; the operator never sees it. */
  truth_iff: string;
  /** What the console currently shows, which the operator may have set. */
  displayed_iff: string;
  /** True once a person changed it, so the system stops overriding them. */
  identified_by_operator: boolean;
  /** When the system resolves it unaided, or null if it never does. */
  resolves_at_s: number | null;

  /* ---- Its transponder, and whether anyone has asked --------------- */
  /** Mode 3/A code it would reply with, or "" for a track that stays silent. */
  mode_3: string;
  /** Mode 1 code it would reply with, or "". Military transponders only. */
  mode_1: string;
  /**
   * True once the operator has interrogated it.
   *
   * Until then the console shows nothing at all — not a blank code, which
   * would read as "asked and got silence". Not having asked and having asked
   * and heard nothing are different pieces of information, and the second one
   * is the one worth acting on.
   */
  squawk_known: boolean;

  state: TrackState;
  /** When it first became visible, for measuring how long a decision took. */
  first_seen_s: number | null;
}

export interface Engagement {
  id: number;
  target: string;
  interceptor: string;
  /** Which launcher it came out of. Always 0 on a single-launcher system. */
  launcher: number;
  launched_s: number;
  /** When the round arrives. */
  impact_s: number;
  /** Decided at launch, revealed at impact. */
  will_hit: boolean;
  /** What the chance was, so the debrief can say whether it was a good shot. */
  pk: number;
  resolved: boolean;
}

export interface SimState {
  /** Seconds since the run began. */
  t: number;
  tracks: RuntimeTrack[];
  engagements: Engagement[];
  events: SimEvent[];
  /**
   * Rounds fired so far, for the whole run.
   *
   * The tally the score reads. On a system that can reload this can exceed
   * the magazine, and should: firing twelve rounds from an eight-round
   * magazine is exactly what the reload cost bought.
   */
  spent: number;
  /** Rounds still in each launcher. One entry when there is one launcher. */
  launcher_rounds: number[];
  /** When each launcher finishes reloading, or null if it is not. */
  reloading_until: (number | null)[];
  /** Where a fixed array is pointed, in degrees of elevation. */
  tilt_deg: number;
  over: boolean;
  /** Counter for engagement ids, so React keys stay stable. */
  nextEngagementId: number;
}

/* ------------------------------------------------------------------ */
/* Building the configuration from what the designer approved          */
/* ------------------------------------------------------------------ */

/** Fallbacks for a profile written before the simulator existed. */
const DEFAULT_DETECTION_KM = 150;
const DEFAULT_INTERCEPTOR_SPEED_KTS = 1600;
const DEFAULT_SIMULTANEOUS = 2;
const DEFAULT_MAGAZINE = 8;
/** How close is "arrived". Small enough to be the site, not the region. */
const DEFAULT_DEFENDED_RADIUS_KM = 3;

/**
 * What the track table shows when the profile declares no columns.
 *
 * The four a console cannot be read without: which track, how far, how long
 * until it arrives, and what it is taken to be. A profile that names its own
 * columns replaces this entirely — including dropping any of these.
 */
const DEFAULT_READOUTS: TrackReadoutField[] = [
  { label: "TRK", unit: "", description: "Track number." },
  { label: "RNG", unit: "km", description: "Range to the track." },
  { label: "TTI", unit: "s", description: "Time to impact." },
  { label: "ID", unit: "", description: "Identification state." },
];

/**
 * How far the radar sees, for a given profile.
 *
 * Exported because the exercise generator needs the same answer: it places
 * tracks, and a track placed beyond what the engine will later consider
 * visible never appears at all. That failure is invisible in review — the
 * exercise reads perfectly — so the two callers share one definition rather
 * than each carrying a fallback that happened to differ.
 */
export function detectionRangeKm(profile: SystemProfile | null): number {
  const stated = profile?.sensor?.max_range_km;
  const envelope = profile?.engagement.max_range_km ?? 0;
  // The scope must at least contain the envelope, or the operator would be
  // asked to shoot at something they cannot see.
  return Math.max(stated ?? DEFAULT_DETECTION_KM, envelope * 1.2);
}

/**
 * Turns an approved profile into the numbers the engine runs on.
 *
 * Every fallback here is a compromise, and each is chosen so that a profile
 * missing the field still produces a *playable* exercise rather than a broken
 * one: an engagement envelope with no stated round becomes a single generic
 * interceptor. None of them are guesses about the designer's real system —
 * they are what lets a profile approved before the simulator existed still be
 * flown, rather than refusing to run until someone goes back and fills in
 * three more fields.
 */
export function simConfig(
  profile: SystemProfile | null,
  exercise: ExerciseInstance,
): SimConfig {
  const engagement = profile?.engagement;
  const sensor = profile?.sensor;

  const maxIntercept = engagement?.max_range_km || 70;
  const minIntercept = engagement?.min_range_km ?? 0;

  const interceptors: InterceptorSpec[] =
    engagement?.interceptors && engagement.interceptors.length > 0
      ? engagement.interceptors.map((round) => ({
          name: round.name,
          min_range_km: round.min_range_km,
          max_range_km: round.max_range_km,
          speed_kts: round.speed_kts || DEFAULT_INTERCEPTOR_SPEED_KTS,
        }))
      : [
          {
            name: "interceptor",
            min_range_km: minIntercept,
            max_range_km: maxIntercept,
            speed_kts: DEFAULT_INTERCEPTOR_SPEED_KTS,
          },
        ];

  return {
    detection_range_km: detectionRangeKm(profile),
    blind_range_km: sensor?.min_range_km ?? 0,
    coverage_deg: sensor?.azimuth_coverage_deg ?? 360,
    boresight_deg: exercise.radar_boresight_deg ?? 0,
    altitude_ft: sensor?.altitude_ft ?? null,

    interceptors,
    max_simultaneous: engagement?.max_simultaneous ?? DEFAULT_SIMULTANEOUS,
    magazine: engagement?.magazine_depth ?? DEFAULT_MAGAZINE,

    readouts:
      profile?.track_readout_fields && profile.track_readout_fields.length > 0
        ? profile.track_readout_fields
        : DEFAULT_READOUTS,

    classes: (profile?.track_classifications ?? [])
      .map((entry) => entry.name.trim())
      .filter((name) => name.length > 0),

    defended_radius_km: DEFAULT_DEFENDED_RADIUS_KM,
    iff: {
      enabled: profile?.iff_interrogation?.enabled === true,
      mode_3: profile?.iff_interrogation?.mode_3 !== false,
      mode_1: profile?.iff_interrogation?.mode_1 === true,
    },

    /* Every extra command is off unless the profile declares it, and a
       command declared without the figure it runs on is treated as off
       rather than as a guess — the profile screen asks for the figure and
       refuses approval until it is there, so this only catches the profiles
       approved before it did. */
    commands: {
      retype: profile?.operator_commands?.retype === true,
      reload: {
        enabled:
          profile?.operator_commands?.reload === true &&
          (profile.operator_commands.reload_seconds ?? 0) > 0,
        seconds: profile?.operator_commands?.reload_seconds ?? 0,
      },
      launchers:
        profile?.operator_commands?.launchers === true
          ? Math.max(1, Math.round(profile.operator_commands.launcher_count ?? 1))
          : 1,
      tilt: {
        enabled:
          profile?.operator_commands?.tilt === true &&
          profile.operator_commands.tilt_min_deg !== null &&
          profile.operator_commands.tilt_max_deg !== null &&
          profile.operator_commands.tilt_min_deg <
            profile.operator_commands.tilt_max_deg,
        min_deg: profile?.operator_commands?.tilt_min_deg ?? 0,
        max_deg: profile?.operator_commands?.tilt_max_deg ?? 0,
      },
    },
    tones: Object.fromEntries(
      (profile?.iff_states ?? []).map((state) => [
        state.name.toLowerCase(),
        state.tone,
      ]),
    ),
  };
}

/** The tone the designer gave this identification state, or neutral. */
export function toneOf(config: SimConfig, iff: string): IffState["tone"] {
  return config.tones[iff.toLowerCase()] ?? "neutral";
}

/* ------------------------------------------------------------------ */
/* Starting a run                                                      */
/* ------------------------------------------------------------------ */

/**
 * How the magazine is shared out between launchers.
 *
 * The total is what the profile declares and does not change: turning
 * launcher choice on adds a decision, it does not add rounds. The remainder
 * goes to the earlier launchers, so seven rounds across two launchers is four
 * and three rather than three and three with one lost.
 */
export function splitMagazine(total: number, launchers: number): number[] {
  const count = Math.max(1, launchers);
  const each = Math.floor(total / count);
  const spare = total % count;
  return Array.from({ length: count }, (_, i) => each + (i < spare ? 1 : 0));
}

export function createSim(tracks: LiveTrack[], config: SimConfig): SimState {
  return {
    t: 0,
    tracks: tracks.map((track) => ({
      designator: track.designator,
      classification: track.classification,
      // What the console shows, which is the truth unless the exercise
      // deliberately made the system wrong about this one.
      displayed_classification:
        track.initial_classification?.trim() || track.classification,
      typed_by_operator: false,
      altitude_ft: track.altitude_ft,
      speed_kts: track.speed_kts,
      heading_deg: track.heading_deg,
      notes: track.notes,

      spawn: polarToVec(track.spawn_bearing_deg, track.spawn_range_km),
      velocity: velocity(track.heading_deg, track.speed_kts),
      appears_at_s: track.appears_at_s,

      truth_iff: track.truth_iff,
      displayed_iff: track.initial_iff,
      identified_by_operator: false,
      resolves_at_s: track.resolves_at_s,

      mode_3: track.mode_3 ?? "",
      mode_1: track.mode_1 ?? "",
      squawk_known: false,

      state: track.appears_at_s > 0 ? "pending" : "airborne",
      first_seen_s: null,
    })),
    engagements: [],
    events: [],
    spent: 0,
    launcher_rounds: splitMagazine(config.magazine, config.commands.launchers),
    reloading_until: Array.from(
      { length: Math.max(1, config.commands.launchers) },
      () => null,
    ),
    // A tilting array starts at its lowest setting, which is what an operator
    // holding a surveillance watch would leave it at: the widest coverage of
    // the approach, and the setting that misses nothing high by much.
    tilt_deg: config.commands.tilt.enabled ? config.commands.tilt.min_deg : 0,
    over: false,
    nextEngagementId: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Where things are                                                    */
/* ------------------------------------------------------------------ */

/** Where a track is now. Straight and level: no manoeuvre is modelled. */
export function positionOf(track: RuntimeTrack, t: number): Vec {
  const flownFor = Math.max(0, t - track.appears_at_s);
  return add(track.spawn, scale(track.velocity, flownFor));
}

export interface TrackView {
  track: RuntimeTrack;
  at: Vec;
  bearing_deg: number;
  range_km: number;
  /** Seconds until it reaches the defended area, or null if it is not closing. */
  tti_s: number | null;
  /** False while it is outside the radar's reach, arc, blind zone or band. */
  visible: boolean;
}

/**
 * Everything the console needs about one track at this instant.
 *
 * Visibility is computed here and nowhere else, so the scope, the track list
 * and the engagement rules can never disagree about whether something is on
 * the picture — which they would, if each worked it out for itself.
 */
export function viewOf(
  track: RuntimeTrack,
  t: number,
  config: SimConfig,
  /**
   * Where the array is pointed right now, from `SimState.tilt_deg`.
   *
   * Required rather than optional on purpose. Visibility is decided here and
   * nowhere else so the scope, the track list and the engagement rules can
   * never disagree — and an argument that could be forgotten is exactly how
   * they would start to. Systems without a tilting array ignore it.
   */
  tiltDeg: number,
): TrackView {
  const at = positionOf(track, t);
  const { bearing_deg, range_km } = vecToPolar(at);

  const airborne = track.state === "airborne" && t >= track.appears_at_s;
  const inRange =
    range_km <= config.detection_range_km && range_km >= config.blind_range_km;
  const inArc = withinArc(bearing_deg, config.boresight_deg, config.coverage_deg);
  const inBand =
    config.altitude_ft === null ||
    (track.altitude_ft >= config.altitude_ft.min &&
      track.altitude_ft <= config.altitude_ft.max);

  /* A fixed array holds nothing under where it is pointed. That is the whole
     cost of the tilt decision: raising it to catch something high drops the
     low approach off the scope, and a track that is not held cannot be
     engaged either — the engagement rules read this same flag. */
  const aboveTilt =
    !config.commands.tilt.enabled ||
    elevationDeg(track.altitude_ft, range_km) >= tiltDeg;

  return {
    track,
    at,
    bearing_deg,
    range_km,
    tti_s: timeToImpact(at, track.velocity, config.defended_radius_km),
    visible: airborne && inRange && inArc && inBand && aboveTilt,
  };
}

/** Where an interceptor is on its way to the intercept point. */
export function interceptorPosition(
  engagement: Engagement,
  state: SimState,
  t: number,
): Vec | null {
  if (engagement.resolved || t < engagement.launched_s) return null;

  const target = state.tracks.find((x) => x.designator === engagement.target);
  if (!target) return null;

  const flight = engagement.impact_s - engagement.launched_s;
  if (flight <= 0) return null;

  // Straight to the predicted intercept point, which is where the target will
  // be when the round arrives — a lead pursuit, as a real round flies.
  const meetsAt = positionOf(target, engagement.impact_s);
  const travelled = Math.min(1, (t - engagement.launched_s) / flight);
  return scale(meetsAt, travelled);
}

/* ------------------------------------------------------------------ */
/* Chance of a kill                                                    */
/* ------------------------------------------------------------------ */

/**
 * How likely this shot is, given where in the envelope it is taken.
 *
 * Best through the middle and worse at both edges: a round at the very limit
 * of its reach has spent its energy, and one fired at a target almost on top
 * of the site has no time to correct. The shape is a compromise rather than
 * ballistics, but it makes the right thing the right thing — waiting for a
 * good geometry beats firing the moment the target crosses the line.
 */
export function probabilityOfKill(
  rangeKm: number,
  round: InterceptorSpec,
): number {
  const span = round.max_range_km - round.min_range_km;
  if (span <= 0) return 0.75;

  const position = (rangeKm - round.min_range_km) / span;
  if (position < 0 || position > 1) return 0;
  return 0.55 + 0.35 * Math.sin(Math.PI * position);
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

/**
 * Everything the operator can ask the system to do.
 *
 * The first four exist on every system. The rest are declared in the profile
 * and refused here when they are not — the console does not offer them, and
 * the engine says no rather than trusting that, because the rule belongs with
 * the rules and a stale tab is not an excuse.
 */
export type Command =
  | { kind: "classify"; designator: string; to: string }
  | { kind: "interrogate"; designator: string }
  | { kind: "engage"; designator: string; interceptor: string; launcher?: number }
  | { kind: "cease"; designator: string }
  /** Correct the type the console shows for a track. */
  | { kind: "retype"; designator: string; to: string }
  /** Refill one launcher, at the cost of the time it takes. */
  | { kind: "reload"; launcher: number }
  /** Point a fixed array at a different elevation. */
  | { kind: "tilt"; to_deg: number };

/** Why a command was refused, phrased for the operator rather than the log. */
export interface Refusal {
  reason: string;
}

function event(
  state: SimState,
  kind: SimEvent["kind"],
  designator: string,
  detail: string,
): SimEvent {
  return { t: Math.round(state.t * 10) / 10, kind, designator, detail };
}

/**
 * Applies one operator command, or refuses it with a reason.
 *
 * Returns the new state either way: a refusal still changes the log, because
 * "tried to fire at TK-3 inside minimum range at T+41" is one of the more
 * useful things a debrief can tell somebody.
 */
export function command(
  state: SimState,
  cmd: Command,
  config: SimConfig,
  random: () => number,
): SimState {
  /* ---- The commands that are about the system, not a track ------- */
  if (cmd.kind === "reload") return reload(state, cmd.launcher, config);
  if (cmd.kind === "tilt") return tilt(state, cmd.to_deg, config);

  const track = state.tracks.find((x) => x.designator === cmd.designator);
  if (!track) return state;

  const view = viewOf(track, state.t, config, state.tilt_deg);

  if (cmd.kind === "retype") {
    if (track.state !== "airborne") return state;
    if (!config.commands.retype) {
      return {
        ...state,
        events: [
          ...state.events,
          event(
            state,
            "refused",
            track.designator,
            "On this system the operator does not set the track type.",
          ),
        ],
      };
    }
    if (cmd.to === track.displayed_classification) return state;

    return {
      ...state,
      tracks: replace(state.tracks, track.designator, {
        ...track,
        displayed_classification: cmd.to,
        typed_by_operator: true,
      }),
      events: [
        ...state.events,
        event(
          state,
          "retyped",
          track.designator,
          `Operator retyped ${track.designator} from ${track.displayed_classification} to ${cmd.to}.`,
        ),
      ],
    };
  }

  if (cmd.kind === "classify") {
    if (track.state !== "airborne") return state;
    return {
      ...state,
      tracks: replace(state.tracks, track.designator, {
        ...track,
        displayed_iff: cmd.to,
        identified_by_operator: true,
      }),
      events: [
        ...state.events,
        event(
          state,
          "classified",
          track.designator,
          `Operator set ${track.designator} to ${cmd.to}.`,
        ),
      ],
    };
  }

  if (cmd.kind === "interrogate") {
    if (track.state !== "airborne") return state;

    /* A system without an interrogator has no such command, and the console
       does not offer one — but the engine refuses rather than trusts that,
       because the rule belongs with the rules. */
    if (!config.iff.enabled) {
      return {
        ...state,
        events: [
          ...state.events,
          event(
            state,
            "refused",
            track.designator,
            "This system has no IFF interrogator.",
          ),
        ],
      };
    }

    // Only the modes the system actually has. A Mode 1 code on a system
    // without Mode 1 is information its operator would never get.
    const mode3 = config.iff.mode_3 ? track.mode_3 : "";
    const mode1 = config.iff.mode_1 ? track.mode_1 : "";
    const reply = describeReply(mode3, mode1);
    const meaning = meaningOfMode3(mode3);

    return {
      ...state,
      tracks: replace(state.tracks, track.designator, {
        ...track,
        squawk_known: true,
      }),
      events: [
        ...state.events,
        event(
          state,
          "interrogated",
          track.designator,
          reply.replied
            ? `${track.designator} replied ${reply.text}${meaning ? ` — ${meaning}` : ""}.`
            : `${track.designator} interrogated: no reply.`,
        ),
      ],
    };
  }

  if (cmd.kind === "cease") {
    const mine = state.engagements.filter(
      (e) => e.target === track.designator && !e.resolved,
    );
    if (mine.length === 0) return state;
    return {
      ...state,
      // A round already in the air is gone. Ceasing stops it counting as an
      // engagement, and the magazine does not get it back — which is the
      // honest cost of a hasty launch.
      engagements: state.engagements.map((e) =>
        e.target === track.designator && !e.resolved
          ? { ...e, resolved: true, will_hit: false }
          : e,
      ),
      events: [
        ...state.events,
        event(
          state,
          "ceased",
          track.designator,
          `Engagement against ${track.designator} broken off; ${mine.length} round(s) wasted.`,
        ),
      ],
    };
  }

  /* ---- Firing --------------------------------------------------- */
  const round =
    config.interceptors.find((r) => r.name === cmd.interceptor) ??
    config.interceptors[0];

  /* Which launcher this comes out of. One launcher unless the profile
     declares more, and out of range means the first — a console that cannot
     choose still has to fire from somewhere. */
  const launcher =
    config.commands.launchers > 1 &&
    typeof cmd.launcher === "number" &&
    cmd.launcher >= 0 &&
    cmd.launcher < config.commands.launchers
      ? cmd.launcher
      : 0;

  const refusal = refuseEngagement(state, track, view, round, config, launcher);
  if (refusal) {
    return {
      ...state,
      events: [
        ...state.events,
        event(
          state,
          "refused",
          track.designator,
          `Engagement refused: ${refusal.reason}`,
        ),
      ],
    };
  }

  const flight = timeToIntercept(view.at, track.velocity, round.speed_kts);
  if (flight === null) {
    return {
      ...state,
      events: [
        ...state.events,
        event(
          state,
          "refused",
          track.designator,
          "Engagement refused: no intercept solution — the round cannot catch it.",
        ),
      ],
    };
  }

  const meetsAt = vecToPolar(positionOf(track, state.t + flight)).range_km;
  const pk = probabilityOfKill(meetsAt, round);

  return {
    ...state,
    spent: state.spent + 1,
    launcher_rounds: state.launcher_rounds.map((left, index) =>
      index === launcher ? left - 1 : left,
    ),
    nextEngagementId: state.nextEngagementId + 1,
    engagements: [
      ...state.engagements,
      {
        id: state.nextEngagementId,
        target: track.designator,
        interceptor: round.name,
        launcher,
        launched_s: state.t,
        impact_s: state.t + flight,
        will_hit: random() < pk,
        pk,
        resolved: false,
      },
    ],
    events: [
      ...state.events,
      event(
        state,
        "launched",
        track.designator,
        `${round.name} launched at ${track.designator}${
          config.commands.launchers > 1 ? ` from launcher ${launcher + 1}` : ""
        } (${view.range_km.toFixed(0)} km, intercept in ${flight.toFixed(0)} s, Pk ${(pk * 100).toFixed(0)}%).`,
      ),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* The commands a profile has to declare before they exist             */
/* ------------------------------------------------------------------ */

/**
 * Refilling one launcher, at the cost of the time it takes.
 *
 * The clock does not stop, and that is the entire lesson: a reload is not a
 * button that undoes scarcity, it is a decision to spend seconds that the
 * next track is using to close. A launcher with a round in the air cannot be
 * reloaded — the rail is committed until the round resolves.
 */
function reload(state: SimState, launcher: number, config: SimConfig): SimState {
  const say = (detail: string): SimState => ({
    ...state,
    events: [...state.events, event(state, "refused", "", detail)],
  });

  if (!config.commands.reload.enabled) {
    return say("This system cannot be reloaded during a run.");
  }
  if (launcher < 0 || launcher >= state.launcher_rounds.length) return state;

  const named =
    config.commands.launchers > 1 ? `Launcher ${launcher + 1}` : "The launcher";

  if (state.reloading_until[launcher] !== null) {
    return say(`${named} is already reloading.`);
  }

  const full = splitMagazine(config.magazine, config.commands.launchers)[launcher];
  if (state.launcher_rounds[launcher] >= full) {
    return say(`${named} is already full.`);
  }
  if (
    state.engagements.some((e) => !e.resolved && e.launcher === launcher)
  ) {
    return say(`${named} has a round in the air and cannot be reloaded yet.`);
  }

  const done = state.t + config.commands.reload.seconds;
  return {
    ...state,
    reloading_until: state.reloading_until.map((until, index) =>
      index === launcher ? done : until,
    ),
    events: [
      ...state.events,
      event(
        state,
        "reloaded",
        "",
        `${named} reloading — ${config.commands.reload.seconds} s, and the clock does not stop.`,
      ),
    ],
  };
}

/**
 * Pointing a fixed array somewhere else in elevation.
 *
 * Instant, because slewing an array is quick next to everything else in a
 * run — and costly anyway, because whatever is now under the beam drops off
 * the scope and cannot be engaged while it is there.
 */
function tilt(state: SimState, toDeg: number, config: SimConfig): SimState {
  if (!config.commands.tilt.enabled) {
    return {
      ...state,
      events: [
        ...state.events,
        event(state, "refused", "", "This radar's elevation is not adjustable."),
      ],
    };
  }

  const next = clamp(
    Math.round(toDeg),
    config.commands.tilt.min_deg,
    config.commands.tilt.max_deg,
  );
  if (next === state.tilt_deg) return state;

  return {
    ...state,
    tilt_deg: next,
    events: [
      ...state.events,
      event(
        state,
        "tilted",
        "",
        `Radar tilt set to ${next}°${
          next > state.tilt_deg
            ? " — anything lower is now under the beam."
            : " — lower cover restored."
        }`,
      ),
    ],
  };
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

/** Every reason the system would not take the shot, in the order it checks. */
function refuseEngagement(
  state: SimState,
  track: RuntimeTrack,
  view: TrackView,
  round: InterceptorSpec,
  config: SimConfig,
  launcher: number,
): Refusal | null {
  const named =
    config.commands.launchers > 1 ? `launcher ${launcher + 1}` : "the launcher";

  if (track.state !== "airborne") {
    return { reason: `${track.designator} is no longer a live track.` };
  }
  if (!view.visible) {
    return {
      reason: config.commands.tilt.enabled
        ? `${track.designator} is not held on radar — check the tilt.`
        : `${track.designator} is not held on radar.`,
    };
  }
  if (state.reloading_until[launcher] !== null) {
    return { reason: `${named} is reloading.` };
  }
  if ((state.launcher_rounds[launcher] ?? 0) <= 0) {
    return {
      reason: config.commands.reload.enabled
        ? `no rounds left on ${named} — reload it.`
        : `no rounds remaining on ${named}.`,
    };
  }

  const inFlight = state.engagements.filter((e) => !e.resolved).length;
  if (inFlight >= config.max_simultaneous) {
    return {
      reason: `${config.max_simultaneous} engagement(s) already in the air — the system allows no more.`,
    };
  }
  if (view.range_km > round.max_range_km) {
    return {
      reason: `${view.range_km.toFixed(0)} km is beyond the ${round.name}'s reach of ${round.max_range_km} km.`,
    };
  }
  if (view.range_km < round.min_range_km) {
    return {
      reason: `${view.range_km.toFixed(0)} km is inside the ${round.name}'s minimum range of ${round.min_range_km} km.`,
    };
  }
  return null;
}

function replace(
  tracks: RuntimeTrack[],
  designator: string,
  next: RuntimeTrack,
): RuntimeTrack[] {
  return tracks.map((track) => (track.designator === designator ? next : track));
}

/* ------------------------------------------------------------------ */
/* The clock                                                           */
/* ------------------------------------------------------------------ */

/**
 * Advances the world by `dt` seconds.
 *
 * Order matters and is deliberate: tracks appear, then the system resolves
 * what it can, then rounds arrive, then arrivals are counted. Resolving before
 * impact means a round already in the air against a track that turns out to be
 * friendly still hits — which is the point, and the reason a hasty launch is
 * expensive.
 */
export function step(state: SimState, dt: number, config: SimConfig): SimState {
  if (state.over) return state;

  const t = state.t + dt;
  const events: SimEvent[] = [];
  const at = (kind: SimEvent["kind"], designator: string, detail: string) =>
    events.push({ t: Math.round(t * 10) / 10, kind, designator, detail });

  let tracks = state.tracks.map((track) => {
    if (track.state === "pending" && t >= track.appears_at_s) {
      return { ...track, state: "airborne" as TrackState };
    }
    return track;
  });

  /* ---- Reloads finishing ---------------------------------------- */
  const full = splitMagazine(config.magazine, config.commands.launchers);
  const launcher_rounds = [...state.launcher_rounds];
  const reloading_until = state.reloading_until.map((until, index) => {
    if (until === null || t < until) return until;
    launcher_rounds[index] = full[index];
    at(
      "reloaded",
      "",
      config.commands.launchers > 1
        ? `Launcher ${index + 1} reloaded — ${full[index]} rounds.`
        : `Reloaded — ${full[index]} rounds.`,
    );
    return null;
  });

  /* ---- Detection and self-resolution ---------------------------- */
  tracks = tracks.map((track) => {
    if (track.state !== "airborne") return track;
    const view = viewOf(track, t, config, state.tilt_deg);
    let next = track;

    if (view.visible && track.first_seen_s === null) {
      next = { ...next, first_seen_s: t };
      at(
        "detected",
        track.designator,
        `${track.designator} detected, ${view.range_km.toFixed(0)} km on ${view.bearing_deg.toFixed(0)}°.`,
      );
    }

    // The system's own identification, which never overrides a person: once
    // an operator has made the call it is theirs, right or wrong.
    if (
      next.resolves_at_s !== null &&
      t >= next.resolves_at_s &&
      !next.identified_by_operator &&
      next.displayed_iff !== next.truth_iff
    ) {
      at(
        "resolved",
        track.designator,
        `${track.designator} resolved to ${next.truth_iff}.`,
      );
      next = { ...next, displayed_iff: next.truth_iff };
    }

    return next;
  });

  /* ---- Rounds arriving ------------------------------------------ */
  const engagements = state.engagements.map((engagement) => {
    if (engagement.resolved || t < engagement.impact_s) return engagement;

    const target = tracks.find((x) => x.designator === engagement.target);
    if (!target || target.state !== "airborne") {
      return { ...engagement, resolved: true };
    }

    if (engagement.will_hit) {
      at(
        "hit",
        target.designator,
        `${target.designator} destroyed by ${engagement.interceptor}. It was ${target.truth_iff}.`,
      );
      tracks = replace(tracks, target.designator, {
        ...target,
        state: "destroyed",
      });
    } else {
      at(
        "miss",
        target.designator,
        `${engagement.interceptor} missed ${target.designator}.`,
      );
    }
    return { ...engagement, resolved: true };
  });

  /* ---- Arrivals and departures ---------------------------------- */
  tracks = tracks.map((track) => {
    if (track.state !== "airborne") return track;
    const view = viewOf(track, t, config, state.tilt_deg);

    if (view.range_km <= config.defended_radius_km) {
      const hostile = toneOf(config, track.truth_iff) === "hostile";
      at(
        "leaked",
        track.designator,
        hostile
          ? `${track.designator} reached the defended area. It was ${track.truth_iff}.`
          : `${track.designator} overflew the site. It was ${track.truth_iff}.`,
      );
      return { ...track, state: "leaked" as TrackState };
    }

    // Well outside the scope and still opening: it is gone, and keeping it
    // would leave dead entries cluttering the list for the rest of the run.
    if (view.range_km > config.detection_range_km * 1.5) {
      return { ...track, state: "departed" as TrackState };
    }
    return track;
  });

  return {
    ...state,
    t,
    tracks,
    engagements,
    launcher_rounds,
    reloading_until,
    events: events.length > 0 ? [...state.events, ...events] : state.events,
  };
}

/** Ends the run, whatever is still in the air. */
export function end(state: SimState, why: string): SimState {
  if (state.over) return state;
  return {
    ...state,
    over: true,
    events: [...state.events, event(state, "ended", "", why)],
  };
}

/* ------------------------------------------------------------------ */
/* What it added up to                                                 */
/* ------------------------------------------------------------------ */

/**
 * Counts the run.
 *
 * Every figure here comes from the event log and the truth of each track, so
 * the score is arithmetic rather than opinion. The model's job in the debrief
 * is to explain these numbers against the expert's reasoning — not to decide
 * them.
 */
export function summarise(
  state: SimState,
  config: SimConfig,
  criteria: SuccessCriteria,
): RunResult {
  const engagedTruths = state.engagements.map(
    (engagement) =>
      state.tracks.find((x) => x.designator === engagement.target)?.truth_iff ??
      "",
  );

  const leakers = state.tracks.filter(
    (track) =>
      track.state === "leaked" && toneOf(config, track.truth_iff) === "hostile",
  ).length;

  const destroyed = state.tracks.filter(
    (track) =>
      track.state === "destroyed" && toneOf(config, track.truth_iff) === "hostile",
  ).length;

  const friendlyEngaged = engagedTruths.filter(
    (truth) => toneOf(config, truth) === "friendly",
  ).length;

  const unknownEngaged = engagedTruths.filter(
    (truth) => toneOf(config, truth) === "neutral",
  ).length;

  /* How long the operator took, measured from the first moment the track was
     both on the scope and showing as hostile, to the launch against it. Only
     the shots that were correct count: reacting quickly to the wrong track is
     not a virtue. */
  const reactions: number[] = [];
  for (const engagement of state.engagements) {
    const track = state.tracks.find((x) => x.designator === engagement.target);
    if (!track || toneOf(config, track.truth_iff) !== "hostile") continue;
    const knowable = Math.max(
      track.first_seen_s ?? 0,
      track.resolves_at_s ?? track.first_seen_s ?? 0,
    );
    reactions.push(Math.max(0, engagement.launched_s - knowable));
  }

  return {
    leakers,
    hostiles_destroyed: destroyed,
    friendly_engaged: friendlyEngaged,
    unknown_engaged: unknownEngaged,
    interceptors_spent: state.spent,
    mean_reaction_s:
      reactions.length > 0
        ? Math.round(
            (reactions.reduce((sum, x) => sum + x, 0) / reactions.length) * 10,
          ) / 10
        : null,
    met_criteria:
      leakers <= criteria.max_leakers &&
      friendlyEngaged === 0 &&
      state.spent <= criteria.max_interceptors_spent,
  };
}
