import type {
  EngagementDoctrine,
  IffState,
  SensorCoverage,
  TrackClassification,
  TrackReadoutField,
} from "./schemas";

/**
 * What a profile must contain before anything can be flown against it.
 *
 * The engine carries a fallback for every one of these, and that was right
 * while the simulator was new: a profile approved before it existed still had
 * to run rather than refuse until someone went back and filled in three more
 * fields. But a fallback is a number nobody chose. A detection range that
 * quietly becomes 150 km, a magazine that quietly becomes eight rounds — the
 * exercise still runs, it just stops being *this* system, and nothing on any
 * screen says so. That is the same failure the profile exists to prevent.
 *
 * So the fallbacks stay, for the profiles that already rely on them, and this
 * decides what a designer is allowed to approve from here on. One definition,
 * read by the form (which refuses to finish), by the extract route and by the
 * save route (which refuse to approve) — because a rule enforced in the
 * browser alone is a rule that a stale tab does not have.
 *
 * Deliberately *not* included: anything the simulation does not read. The
 * prose sections, the notes, the altitude band, the close-in blind zone — a
 * designer who does not know their radar's ceiling should still be able to
 * finish, and a form that demands what someone cannot answer gets filled in
 * with invented numbers, which is worse than an empty field.
 */

/** One thing missing, and where on the form to fix it. */
export interface Gap {
  /** The section heading it sits under, so it can be found. */
  where: string;
  /** What is wrong, in the designer's terms. */
  what: string;
}

/** The measured half of a profile — the only half the simulation reads. */
export interface SimulationSpec {
  sensor: SensorCoverage;
  engagement: EngagementDoctrine;
  track_classifications: TrackClassification[];
  iff_states: IffState[];
  track_readout_fields: TrackReadoutField[];
}

const RADAR = "What the radar sees";
const CLASSES = "What can appear on the display";
const STATES = "Identification states";
const COLUMNS = "What the operator reads for each track";
const ENVELOPE = "What it can reach";

const positive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Everything standing between this profile and a run.
 *
 * Empty means it can be approved. Order matters: the list is read top to
 * bottom by someone fixing it, so it follows the order of the form.
 */
export function simulationGaps(spec: SimulationSpec): Gap[] {
  const gaps: Gap[] = [];
  const say = (where: string, what: string) => gaps.push({ where, what });

  /* ---- The radar ------------------------------------------------- */
  // Detection range is the clock on every scenario about time: it decides how
  // long the operator has between seeing something and having to act.
  if (!positive(spec.sensor.max_range_km)) {
    say(RADAR, "Detection range is empty. It decides how much warning the operator gets, so nothing can be placed on the scope without it.");
  }
  if (!positive(spec.sensor.azimuth_coverage_deg)) {
    say(RADAR, "Azimuth coverage is empty. 360° for a rotating radar; the arc it faces for a fixed array.");
  } else if (spec.sensor.azimuth_coverage_deg! > 360) {
    say(RADAR, `Azimuth coverage is ${spec.sensor.azimuth_coverage_deg}°, which is more than a full circle.`);
  }
  if (spec.sensor.min_range_km !== null && spec.sensor.min_range_km < 0) {
    say(RADAR, "The close-in blind zone cannot be negative. Leave it empty if there is none.");
  }

  /* ---- What can appear ------------------------------------------- */
  if (spec.track_classifications.length === 0) {
    say(CLASSES, "No track classes. An exercise may only produce tracks of the kinds declared here, so with none there is nothing to fly.");
  }
  spec.track_classifications.forEach((entry, index) => {
    const name = entry.name.trim() || `class ${index + 1}`;
    if (!entry.name.trim()) {
      say(CLASSES, `Class ${index + 1} has no name. The exercise refers to classes by name.`);
    }
    if (!positive(entry.typical_speed_kts.max)) {
      say(CLASSES, `“${name}” has no top speed. Speed is what moves the track across the scope — at zero it never arrives.`);
    } else if (entry.typical_speed_kts.min > entry.typical_speed_kts.max) {
      say(CLASSES, `“${name}” has a speed band that runs backwards (${entry.typical_speed_kts.min}–${entry.typical_speed_kts.max} kts).`);
    }
    if (entry.typical_altitude_ft.min > entry.typical_altitude_ft.max) {
      say(CLASSES, `“${name}” has an altitude band that runs backwards (${entry.typical_altitude_ft.min}–${entry.typical_altitude_ft.max} ft).`);
    }
  });

  /* ---- Identification -------------------------------------------- */
  if (spec.iff_states.length === 0) {
    say(STATES, "No identification states. Every track carries one, and the operator's whole judgement is about which.");
  } else {
    if (spec.iff_states.some((state) => !state.name.trim())) {
      say(STATES, "An identification state has no name. The exercise and the console both refer to them by name.");
    }
    // Without something hostile there is nothing to defend against; without
    // something that is not, there is no wrong thing to shoot — and a run
    // where every track is a valid target trains the wrong reflex.
    if (!spec.iff_states.some((state) => state.tone === "hostile")) {
      say(STATES, "No state is marked hostile. With nothing hostile there is no threat to engage.");
    }
    if (!spec.iff_states.some((state) => state.tone !== "hostile")) {
      say(STATES, "Every state is hostile. At least one must not be, or there is nothing the operator can wrongly shoot.");
    }
  }

  /* ---- The columns ------------------------------------------------ */
  if (spec.track_readout_fields.length === 0) {
    say(COLUMNS, "No readout columns. These are the table the trainee reads, so with none they fly blind.");
  } else if (spec.track_readout_fields.some((field) => !field.label.trim())) {
    say(COLUMNS, "A column has no header.");
  }

  /* ---- The envelope ----------------------------------------------- */
  const { engagement } = spec;
  if (!positive(engagement.max_range_km)) {
    say(ENVELOPE, "Maximum intercept range is empty. Without it nothing can be engaged at all.");
  }
  if (engagement.min_range_km < 0) {
    say(ENVELOPE, "Minimum intercept range cannot be negative.");
  } else if (
    positive(engagement.max_range_km) &&
    engagement.min_range_km >= engagement.max_range_km
  ) {
    say(ENVELOPE, `The envelope is inside out: minimum ${engagement.min_range_km} km is not less than maximum ${engagement.max_range_km} km.`);
  }

  // A weapon that outreaches its own radar means the operator is asked to
  // shoot at something they cannot see. The engine silently widens the scope
  // to cover it, which throws away the range that was actually typed here.
  if (
    positive(spec.sensor.max_range_km) &&
    positive(engagement.max_range_km) &&
    spec.sensor.max_range_km! < engagement.max_range_km
  ) {
    say(RADAR, `Detection range (${spec.sensor.max_range_km} km) is shorter than the engagement envelope (${engagement.max_range_km} km), so a target would be shootable before it is visible.`);
  }

  if (engagement.interceptors.length === 0) {
    say(ENVELOPE, "No interceptor types. The operator chooses a round before firing, and its speed is what sets the time of flight.");
  }
  engagement.interceptors.forEach((round, index) => {
    const name = round.name.trim() || `interceptor ${index + 1}`;
    if (!round.name.trim()) {
      say(ENVELOPE, `Interceptor ${index + 1} has no name. The operator picks rounds by name.`);
    }
    if (!positive(round.max_range_km)) {
      say(ENVELOPE, `“${name}” has no maximum range, so it can never reach anything.`);
    } else if (round.min_range_km >= round.max_range_km) {
      say(ENVELOPE, `“${name}” has a range that runs backwards (${round.min_range_km}–${round.max_range_km} km).`);
    }
    if (!positive(round.speed_kts)) {
      say(ENVELOPE, `“${name}” has no speed. Speed is the time of flight — how much earlier than impact the decision has to be made.`);
    }
  });

  if (!positive(engagement.max_simultaneous)) {
    say(ENVELOPE, "“Interceptors in the air at once” is empty. It is the limit that makes a third launch a refusal instead of a shrug.");
  }
  if (!positive(engagement.magazine_depth)) {
    say(ENVELOPE, "“Rounds available” is empty. Without a magazine, spending rounds costs nothing and efficiency is not trained.");
  }

  return gaps;
}

/** The same list as one line, for an API response or a log. */
export function gapMessage(gaps: Gap[]): string {
  return `The simulation cannot run on this profile yet — ${gaps.length} thing${gaps.length === 1 ? "" : "s"} to complete: ${gaps
    .map((gap) => `${gap.where}: ${gap.what}`)
    .join(" ")}`;
}
