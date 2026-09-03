import "server-only";
import {
  LiveTrackSchema,
  SuccessCriteriaSchema,
  type DifficultyLevel,
  type ScenarioEntry,
  type LiveTrack,
  type ExerciseInstance,
  type SystemProfile,
  type TrackClassification,
} from "../../domain/schemas";
import { isMode1, isMode3 } from "../../domain/iff-codes";
import { structured } from "../client";
import { detectionRangeKm } from "../../sim/engine";
import { knotsToKmPerSecond } from "../../sim/geometry";
import { z } from "zod";

/**
 * Screen 3, step 2 — turning an abstract scenario into one runnable engagement.
 *
 * The scenario says "between 3 and 6 threats, one of them ambiguous". This call
 * decides that today there are four, that TK-2214 is the ambiguous one, that it
 * comes in from 340° at 140 km doing 480 knots, and that the system will not
 * resolve it until it is already inside the envelope.
 *
 * What changed when the trainer stopped being a quiz: this used to emit the
 * numbers a console should *display*. It now emits the numbers a track
 * actually *has* — where it starts, where it is going, how fast — and the
 * simulation derives every readout from those. A generator cannot produce a
 * track whose range and time-to-impact disagree, because it no longer produces
 * either one.
 *
 * The profile still governs everything it covers, and this time it is enforced
 * rather than asked for: `clampToProfile` below rewrites anything outside the
 * declared bands. A model that puts a jet at 90,000 feet is not an error to
 * catch in review, it is an exercise that must never reach a trainee.
 */

const EXERCISE_SYSTEM = `You lay out one concrete, runnable air-defence engagement — an **exercise** — from a stored **scenario**.

The scenario is the situation and the **dilemmas** its designer decided belong in it. Your job is to make those dilemmas actually happen to somebody: an exercise where a dilemma the scenario names never arises has not rendered the scenario, however good the geometry looks.

The trainee will fly this in real time: tracks move at the speeds you give them, from where you put them, and the operator has to detect, identify and engage before they arrive. You are placing a tactical problem on a map, not writing questions.

## Coordinates

- **Bearing** is degrees clockwise from north, 0–360. The defended site is at the centre.
- **Range** is kilometres from the site.
- **Heading** is the direction a track flies, in the same convention. A track that attacks the site flies on roughly the reciprocal of its own bearing: something at 090° heads about 270° to close.
- **Speed** is knots, **altitude** is feet.

## The system profile governs everything it covers

- **Every track's classification must be one of the declared classifications, by name.** Never invent one.
- **Speed and altitude must sit inside the band that classification declares.**
- **truth_iff and initial_iff must be declared identification states, by name.**
- **Spawn range must be inside the radar's detection range**, and outside any close-in blind zone. A track that starts where it cannot be seen is invisible for the whole run.
- **Where the radar covers less than 360°, it faces \`radar_boresight_deg\` and is blind behind it.** Put the main threat inside that arc unless the scenario is specifically about a gap — and if it is, say so in the brief.

## Making it a real problem

**Geometry is the exercise.** Time the arrivals so the operator is forced to choose: two threats that converge at once against a system that can only engage one at a time, or an ambiguous track closer than a confirmed one. Work out roughly when each track reaches the engagement envelope and stagger them deliberately. Threats that arrive comfortably one after another teach nothing.

**truth_iff is what the track really is; initial_iff is what the console shows at first.** The gap between them is where identification training lives. \`resolves_at_s\` is when the system works it out unaided — set it late to force the operator to decide alone, or leave it null so it never resolves and the call is entirely theirs.

**The transponder codes, when the system can interrogate.** Each declared classification says what it carries, and that is binding:

- A class marked **none** replies to nothing: \`mode_3\` and \`mode_1\` must both be \`""\`. **Silence is the point** — it is what makes an unknown track a decision rather than a lookup, so most hostile tracks should be silent.
- A class marked **civil** replies on Mode 3 only: \`mode_3\` is four digits, each 0–7; \`mode_1\` is \`""\`.
- A class marked **military** may reply on both: \`mode_3\` as above, \`mode_1\` two digits, each 0–4.

A code is not decoration. Give an airliner an ordinary code and it reads as an airliner; give one \`7700\` (general emergency), \`7600\` (radio failure) or \`7500\` (hijack) and you have built a specific and much harder problem — **do that deliberately, and say so in the brief**, never by accident. Two tracks squawking the same Mode 3 code is also a real and vicious problem, and again only worth doing on purpose.

**Include at least one track that must not be engaged** — a friendly or a civil transit — unless the scenario is explicitly about something else. An exercise where everything airborne is a valid target trains the wrong reflex.

**appears_at_s staggers entries.** Tracks already up at zero should be a manageable picture; later arrivals are what turns it into a problem.

## time_window_seconds is a floor, not a free choice

The run has to be long enough for the fastest track in it to fly from outside the engagement envelope to the site. That approach is where identification happens, and a run that starts with everything already shootable has cut out the interesting half of the job.

**The floor is exactly this**, and it is enforced, so work it out rather than estimating:

    floor = (engagement max_range_km × 1.25) ÷ (fastest speed_kts × 0.0005144 km/s per knot) ÷ 0.9

The 1.25 starts the track a quarter beyond the envelope, so there is an approach to read before the shot is available; the 0.9 leaves the last tenth of the run to see the outcome. Worked example: a 70 km envelope with a 600-knot track gives (70 × 1.25) ÷ 0.3086 ÷ 0.9 ≈ 315 seconds. Estimating from the envelope alone gives about 227 and is wrong.

**So a request for a shorter run cannot be met by shortening the clock alone.** If the geometry does not allow it, the honest ways to give a designer a shorter exercise are slower tracks, a closer start, or arrivals brought forward — say which you did. A window below the floor is silently raised back, and then your account of what you changed is untrue.

Ten minutes is the longest a run goes.

## success_criteria

State plainly what winning means, and set \`max_interceptors_spent\` so that efficiency actually costs something — roughly one round per hostile plus one spare, not the whole magazine.

## The brief

**situation_brief** is what the operator reads before the clock starts: their posture, what is expected, what they hold. It sets the problem and never hints at which track is which.

Keep it vendor-neutral: invented track designators, no real unit or platform names.

## When you are given an exercise to correct

You may be handed an exercise you produced before along with what the designer says is wrong with it, oldest complaint first.

- **Fix what was named and leave the rest.** A request to move one arrival later is not licence to redraw the engagement. The designer is converging on an exercise they can use, and every unrequested change costs them ground they had already taken.
- **All the complaints still stand.** The newest is what they just said; the earlier ones were fixed and must stay fixed.
- **Keep what identifies the exercise where you can** — its name, the shape of the problem, the tracks they did not complain about. A correction that returns an unrecognisably different exercise is not a correction.
- Every rule above still binds: the profile's classes and bands, the engagement envelope, the operator's own responsibilities. If a request cannot be met without breaking one, do the nearest thing that does not and say so in your notes.

## notes_for_designer

One or two sentences: what you changed this time and why, or — on a first generation — what you built the engagement around. This is read beside the request that prompted it, so be specific: "moved the second arrival from T+40 to T+95 so the first is resolved before it appears", not "improved the timing".`;

/** What the model returns. Everything else is computed or clamped in code. */
const ExerciseDraftSchema = z.object({
  /** What was changed, or what the engagement was built around. */
  notes_for_designer: z.string().default(""),
  exercise_name: z.string(),
  situation_brief: z.string(),
  time_window_seconds: z.number(),
  radar_boresight_deg: z.number(),
  live_tracks: z.array(LiveTrackSchema),
  success_criteria: SuccessCriteriaSchema,
  resources: z.array(
    z.object({
      name: z.string(),
      unit: z.string(),
      available: z.number(),
      total: z.number(),
    }),
  ),
});

const DIFFICULTY_GUIDANCE: Record<DifficultyLevel, string> = {
  easy: "Keep the geometry legible and the arrivals separated. One decision at a time, with room to think. The scenario should still bite, but not as a scramble.",
  medium:
    "Standard operational pressure. At least one moment where two things need attention at once, and the trade-off should be uncomfortable.",
  hard: "Compress everything. Overlapping arrivals, an ambiguous track among them, and not enough rounds to be careless. The operator should finish aware that something had to be given up.",
};

/** What a generation produced, and its own account of what it did. */
export interface GeneratedExercise {
  exercise: ExerciseInstance;
  notes: string;
  /**
   * What the enforcement below had to override, in the designer's terms.
   *
   * Shown beside the notes rather than swallowed: a request the system cannot
   * honour is worth one sentence saying so, and without it the model's account
   * of what it changed can be flatly untrue.
   */
  adjustments: string[];
}

export async function generateExercise(
  scenario: ScenarioEntry,
  difficulty: DifficultyLevel,
  profile: SystemProfile | null,
  /**
   * A correction rather than a first attempt.
   *
   * The exercise to fix and everything the designer has said is wrong with
   * it, oldest first. The whole list travels every time, for the same reason
   * the console's does: a fix that honours the newest complaint while undoing
   * the last one is how this goes round in circles.
   */
  revise?: { previous: ExerciseInstance; requests: string[] },
): Promise<GeneratedExercise> {
  const band = scenario.difficulty_scaling[difficulty];
  const asked = (revise?.requests ?? []).filter(
    (entry) => entry.trim().length > 0,
  );

  const draft = await structured({
    system: EXERCISE_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          profile
            ? `<system_profile>\n${JSON.stringify(stripProvenance(profile), null, 2)}\n</system_profile>`
            : "<system_profile>none taught — use generic conventions</system_profile>",
          `<scenario>\n${JSON.stringify(forGeneration(scenario), null, 2)}\n</scenario>`,
          `<difficulty level="${difficulty}">\n${JSON.stringify(band, null, 2)}\n</difficulty>`,
          `<guidance>${DIFFICULTY_GUIDANCE[difficulty]}</guidance>`,
          revise
            ? `Here is the exercise as it stands. Correct it; do not start over.\n\n<current_exercise>\n${JSON.stringify(revise.previous, null, 2)}\n</current_exercise>`
            : "",
          asked.length > 0
            ? `What the designer says is wrong with it, oldest first. All of it still stands.\n\n<complaints>\n${asked
                .map((entry, index) => `${index + 1}. ${entry}`)
                .join("\n")}\n</complaints>`
            : "",
          revise ? "Produce the corrected exercise." : "Lay out the engagement.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    schema: ExerciseDraftSchema,
    effort: "high",
    maxTokens: 16000,
    label: revise ? "exercise-revision" : "exercise",
    mock: () => mockExercise(scenario, difficulty, profile),
  });

  const { exercise, adjustments } = clampToProfile(draft, profile);
  return { exercise, notes: draft.notes_for_designer, adjustments };
}

/* ------------------------------------------------------------------ */
/* Enforcement                                                         */
/* ------------------------------------------------------------------ */

/**
 * Rewrites anything the model put outside what the system can actually do.
 *
 * Asking a prompt nicely is not enforcement. A track spawned beyond the radar
 * is invisible for the whole run; one inside the blind zone never appears; a
 * speed outside its class band makes the class label a lie. None of those are
 * caught by review, because the exercise *looks* fine — they only show up as a
 * trainee sitting in front of a picture that will not behave.
 *
 * So every figure the simulation depends on is clamped here, against the same
 * profile the designer approved. The model's real contribution is the
 * *arrangement*: who comes from where, in what order, and which one is the
 * problem.
 */
function clampToProfile(
  draft: z.infer<typeof ExerciseDraftSchema>,
  profile: SystemProfile | null,
): { exercise: ExerciseInstance; adjustments: string[] } {
  /* What had to be overridden, in words the designer can act on.
     Silence here was a real fault: a designer said the run was too long, the
     model said it had shortened it, the floor below put it back, and the only
     record was a note claiming a change that had not happened. A clamp the
     designer cannot see is a clamp that makes the notes lie. */
  const adjustments: string[] = [];
  const detection = detectionRangeKm(profile);
  const blind = profile?.sensor?.min_range_km ?? 0;

  const classes = new Map(
    (profile?.track_classifications ?? []).map((entry) => [
      entry.name.toLowerCase(),
      entry,
    ]),
  );
  const states = (profile?.iff_states ?? []).map((state) => state.name);
  const nameOf = (value: string, fallback: string) =>
    states.find((state) => state.toLowerCase() === value.toLowerCase()) ??
    fallback;

  const seen = new Set<string>();

  const live_tracks: LiveTrack[] = draft.live_tracks.map((track, index) => {
    // Designators have to be unique: they key the React tree, and the engine
    // finds a track by its name when a round arrives.
    let designator = track.designator.trim() || `TK-${1000 + index}`;
    while (seen.has(designator)) designator = `${designator}A`;
    seen.add(designator);

    const declared = classes.get(track.classification.toLowerCase());

    return {
      ...track,
      designator,
      classification: declared?.name ?? track.classification,

      spawn_bearing_deg: ((track.spawn_bearing_deg % 360) + 360) % 360,
      // Inside the scope and outside the blind zone, with a little margin so
      // the operator sees it arrive rather than finding it already there.
      spawn_range_km: clamp(
        track.spawn_range_km,
        Math.max(blind + 5, detection * 0.35),
        detection * 0.98,
      ),
      heading_deg: ((track.heading_deg % 360) + 360) % 360,

      speed_kts: declared
        ? clamp(
            track.speed_kts,
            declared.typical_speed_kts.min,
            declared.typical_speed_kts.max,
          )
        : Math.max(40, track.speed_kts),
      altitude_ft: declared
        ? clamp(
            track.altitude_ft,
            declared.typical_altitude_ft.min,
            declared.typical_altitude_ft.max,
          )
        : Math.max(0, track.altitude_ft),

      truth_iff: nameOf(track.truth_iff, states[0] ?? track.truth_iff),
      initial_iff: nameOf(track.initial_iff, states[0] ?? track.initial_iff),
      resolves_at_s:
        track.resolves_at_s === null ? null : Math.max(0, track.resolves_at_s),
      appears_at_s: Math.max(0, track.appears_at_s),

      /* The class decides what may reply, not the model. A cruise missile
         handed a squawk would let a trainee identify it by asking, which is
         exactly the shortcut the class declaration exists to forbid. */
      ...transponderReply(track, declared),
    };
  });

  const window = windowFor(draft.time_window_seconds, live_tracks, profile);
  if (window !== Math.round(draft.time_window_seconds)) {
    adjustments.push(
      `The run is ${window} seconds rather than the ${Math.round(draft.time_window_seconds)} asked for. ` +
        (window > draft.time_window_seconds
          ? "Any shorter and the fastest track would start already inside the engagement envelope, leaving nothing to identify on the way in."
          : "Ten minutes is the longest a run goes."),
    );
  }

  const exercise: ExerciseInstance = {
    exercise_name: draft.exercise_name,
    situation_brief: draft.situation_brief,
    time_window_seconds: window,
    radar_boresight_deg: ((draft.radar_boresight_deg % 360) + 360) % 360,
    live_tracks: placeArrivals(live_tracks, window, detection, blind),
    success_criteria: {
      ...draft.success_criteria,
      max_leakers: Math.max(0, draft.success_criteria.max_leakers),
      max_interceptors_spent: clamp(
        draft.success_criteria.max_interceptors_spent,
        1,
        profile?.engagement.magazine_depth ?? 99,
      ),
    },
    resources: draft.resources,
    tracks: [],
    dilemmas: [],
  };

  return { exercise, adjustments };
}

/**
 * Places every track so that its arrival falls inside the run.
 *
 * Left to itself this goes wrong in both directions, and neither shows up in
 * review because every individual figure is sensible. Ask for a five-minute
 * exercise and a generator will happily put a 150-knot helicopter 130 km out:
 * the transit is half an hour, the clock expires with the track still inbound,
 * and the trainee has spent the run watching a symbol creep. Compress the
 * geometry to fit instead and everything starts inside the engagement
 * envelope, which deletes the part of the job where you watch something
 * approach and decide what it is.
 *
 * So arrivals are *placed*: spread down the second half of the run, furthest
 * first, and the range each track starts at is whatever its own speed implies
 * for that arrival. A fast mover ends up outside the envelope with a real
 * approach to read; a slow one starts closer, which is where a slow mover is
 * detected anyway on a radar whose range does not care how fast the target is.
 *
 * The scenario's own time window is a floor rather than a ceiling here: it
 * describes how long a *decision* should take, and was never a claim about how
 * long an aircraft needs to fly a hundred kilometres.
 */
function placeArrivals(
  tracks: LiveTrack[],
  windowSeconds: number,
  detectionKm: number,
  blindKm: number,
): LiveTrack[] {
  const last = Math.max(1, tracks.length - 1);

  return tracks.map((track, index) => {
    const kmPerSecond = knotsToKmPerSecond(track.speed_kts);
    if (kmPerSecond <= 0) return track;

    // First listed arrives latest, so the picture builds rather than empties.
    const share = 0.9 - (0.4 * index) / last;
    const flightTime = Math.max(30, windowSeconds * share - track.appears_at_s);

    const range = DEFENDED_RADIUS_KM + kmPerSecond * flightTime;
    return {
      ...track,
      spawn_range_km: clamp(
        range,
        Math.max(blindKm + 5, 8),
        detectionKm * 0.98,
      ),
    };
  });
}

/** Matches the engine's own idea of how close counts as arrived. */
const DEFENDED_RADIUS_KM = 3;

/**
 * How long the run needs to be for the engagement to have a shape.
 *
 * The shortest exercise worth flying has the fastest track appear *outside*
 * the engagement envelope, giving the operator an approach to read before the
 * shot is available — that gap is where identification happens, and a run that
 * starts with everything already shootable has cut out the interesting half of
 * the job.
 *
 * That sets a floor, derived from the envelope and the quickest thing in the
 * air rather than picked. A designer asking for longer gets longer; the cap
 * exists because ten minutes is already a long time to hold a position, and
 * beyond it a run stops being an exercise and becomes a wait.
 *
 * The prompt states this same formula and both of its constants, so the model
 * arrives at the same figure. It used to be told only that a floor existed,
 * and estimated it from the envelope alone — which produced a request the
 * enforcement then had to override every time, and a "could not be done" line
 * about arithmetic rather than about anything impossible.
 */
function windowFor(
  requested: number,
  tracks: LiveTrack[],
  profile: SystemProfile | null,
): number {
  const envelope = profile?.engagement.max_range_km ?? 70;
  const quickest = Math.max(
    120,
    ...tracks.map((track) => track.speed_kts).filter(Number.isFinite),
  );

  // Fly in from a quarter beyond the envelope, and leave the arrival at nine
  // tenths of the run so there is time to see the outcome.
  const approach = (envelope * 1.25) / knotsToKmPerSecond(quickest);
  return clamp(Math.max(requested, Math.round(approach / 0.9)), 240, 600);
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(high, Math.max(low, value));
}

/**
 * What this track is actually allowed to reply, whatever the model wrote.
 *
 * Two rules, and both of them protect the exercise rather than the data. A
 * class the designer marked as carrying nothing must stay silent, or a trainee
 * could identify a cruise missile by interrogating it — the shortcut the
 * declaration exists to forbid. And a malformed code is dropped rather than
 * repaired: a console showing `8291` as a Mode 3 code teaches an operator that
 * such a code exists.
 */
function transponderReply(
  track: LiveTrack,
  declared: TrackClassification | undefined,
): { mode_3: string; mode_1: string } {
  const kind = declared?.transponder ?? "none";
  if (kind === "none") return { mode_3: "", mode_1: "" };

  const mode3 = (track.mode_3 ?? "").trim();
  const mode1 = (track.mode_1 ?? "").trim();

  return {
    mode_3: isMode3(mode3) ? mode3 : "",
    mode_1: kind === "military" && isMode1(mode1) ? mode1 : "",
  };
}

/**
 * The scenario, without the parts a generation cannot use.
 *
 * `source_chat_log` is the whole transcript of the interview the entry was
 * extracted from — measured at a fifth of everything this call sends on a real
 * record. It is kept so an entry can be audited against the conversation that
 * produced it, and it is worth nothing here: the structured entry beside it is
 * that conversation's conclusion, already agreed. Paying for both, on every
 * trainee run and every correction, was buying the working out twice.
 *
 * The timestamps and the approval flag go for the same reason `stripProvenance`
 * drops them from the profile: they record how the entry came to exist, not
 * what it says.
 */
function forGeneration(scenario: ScenarioEntry) {
  const {
    source_chat_log,
    created_at,
    approved_at,
    status,
    system_id,
    ...substance
  } = scenario;
  void source_chat_log;
  void created_at;
  void approved_at;
  void status;
  void system_id;
  return substance;
}

/** The raw answers and timestamps are provenance, not behaviour. */
function stripProvenance(profile: SystemProfile) {
  const { id, approved, source_answers, created_at, approved_at, ...behaviour } =
    profile;
  void id;
  void approved;
  void source_answers;
  void created_at;
  void approved_at;
  return behaviour;
}

/* ------------------------------------------------------------------ */

/**
 * A playable stand-in when no API key is configured.
 *
 * Deliberately a real engagement rather than a placeholder: three tracks
 * closing from the same general direction, one of them friendly, so the whole
 * console can be exercised — select, identify, fire, hit, miss, leak — without
 * spending anything.
 */
function mockExercise(
  scenario: ScenarioEntry,
  difficulty: DifficultyLevel,
  profile: SystemProfile | null,
): z.infer<typeof ExerciseDraftSchema> {
  const band = scenario.difficulty_scaling[difficulty];
  const classes = profile?.track_classifications ?? [];
  const states = profile?.iff_states ?? [];

  const hostile =
    states.find((state) => state.tone === "hostile")?.name ?? "hostile";
  const friendly =
    states.find((state) => state.tone === "friendly")?.name ?? "friendly";
  const unknown =
    states.find((state) => state.tone === "neutral")?.name ?? "unknown";
  const klass = (index: number) => classes[index % Math.max(classes.length, 1)];

  const detection = detectionRangeKm(profile);
  const boresight = profile?.sensor.azimuth_coverage_deg
    ? profile.sensor.azimuth_coverage_deg < 360
      ? 20
      : 0
    : 0;

  const track = (
    over: Partial<LiveTrack> & { designator: string; bearing: number },
  ): LiveTrack => {
    const declared = klass(0);
    const { bearing, ...rest } = over;
    return {
      classification: declared?.name ?? "aircraft",
      spawn_bearing_deg: bearing,
      spawn_range_km: detection * 0.85,
      altitude_ft: declared?.typical_altitude_ft.min ?? 15000,
      // Straight at the site: the reciprocal of where it is.
      heading_deg: (bearing + 180) % 360,
      speed_kts: declared?.typical_speed_kts.min ?? 420,
      truth_iff: hostile,
      initial_iff: unknown,
      resolves_at_s: null,
      appears_at_s: 0,
      notes: "",
      mode_3: "",
      mode_1: "",
      ...rest,
    };
  };

  return {
    notes_for_designer:
      "Mock generation — no ANTHROPIC_API_KEY is configured, so this engagement is a built-in placeholder rather than one laid out for this scenario.",
    exercise_name: `Mock run — ${scenario.title} (${difficulty})`,
    situation_brief:
      "Mock exercise. No ANTHROPIC_API_KEY is configured, so this engagement is laid out locally rather than by the model — but it runs exactly like a real one. Three inbounds, and one of them is not a threat.",
    time_window_seconds: Math.max(180, band.time_window_seconds.min),
    radar_boresight_deg: boresight,
    live_tracks: [
      track({ designator: "TK-1101", bearing: boresight - 15 }),
      {
        ...track({ designator: "TK-1102", bearing: boresight + 12 }),
        appears_at_s: 25,
        truth_iff: friendly,
        initial_iff: unknown,
        resolves_at_s: 70,
        // A civil code, so mock mode exercises interrogation too. Dropped
        // again by `transponderReply` if this class carries no transponder.
        mode_3: "1200",
        notes: "Squawking late. Not a threat, whatever the display says at first.",
      },
      {
        ...track({ designator: "TK-1103", bearing: boresight + 30 }),
        appears_at_s: 45,
        classification: klass(1)?.name ?? klass(0)?.name ?? "aircraft",
        notes: "Low and closing.",
      },
    ],
    success_criteria: {
      max_leakers: 0,
      max_interceptors_spent: 4,
      statement:
        "Stop both hostiles outside the defended area without engaging the friendly.",
    },
    resources: scenario.key_variables.resource_levels.map((resource) => ({
      name: resource.name,
      unit: resource.unit,
      available: resource.min,
      total: resource.max,
    })),
  };
}
