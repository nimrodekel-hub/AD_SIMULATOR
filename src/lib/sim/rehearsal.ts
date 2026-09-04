import type { ExerciseInstance, SystemProfile } from "../domain/schemas";
import { codesFor } from "../domain/iff-codes";
import { detectionRangeKm } from "./engine";
import { knotsToKmPerSecond, seededRandom } from "./geometry";

/**
 * An engagement built in code, for the designer to test their own system with.
 *
 * Nothing earlier in the setup sequence answers the questions this does. A
 * profile is a form: it can hold a detection range that gives an operator four
 * seconds of warning, or an interceptor too slow to catch anything it is aimed
 * at, and the form will accept both. A console preview is an empty shell: it
 * shows where the panels are and cannot say whether the track list holds six
 * rows, whether the scope is still square once a radar is drawn in it, or
 * whether the fire controls still fit when the firing solution appears beside
 * them. The only way to know any of it is to put things in the air and watch.
 *
 * Deliberately **no model call and no scenario**. A designer testing their own
 * figures should not wait seventy seconds or spend anything, and should not
 * need an approved scenario to exist yet — this step comes before any of that.
 * It is also why the exercise is dull on purpose: it exists to exercise every
 * figure and load every panel, not to teach a lesson.
 *
 * What it does insist on is being the *real* thing: the same `ExerciseInstance`
 * the trainee's run is given, so it flows through the same engine and the same
 * console. A test against a near-copy would prove nothing about the real one.
 */

/** Enough tracks to fill a list and force a second decision. */
const TRACK_COUNT = 5;

export function rehearsalExercise(profile: SystemProfile | null): ExerciseInstance {
  const detection = detectionRangeKm(profile);
  const blind = profile?.sensor?.min_range_km ?? 0;
  const envelope = profile?.engagement.max_range_km ?? 70;

  const classes = profile?.track_classifications ?? [];
  const states = profile?.iff_states ?? [];

  /* Every tone the console can colour, so the designer sees all of them at
     once rather than discovering after approval that hostile and friendly are
     the same shade of grey in their palette. */
  const byTone = (tone: string) =>
    states.find((state) => state.tone === tone)?.name;
  const hostile = byTone("hostile") ?? states[0]?.name ?? "hostile";
  const friendly = byTone("friendly") ?? states[0]?.name ?? "friendly";
  const unknown = byTone("neutral") ?? byTone("caution") ?? hostile;

  const boresight =
    profile?.sensor?.azimuth_coverage_deg &&
    profile.sensor.azimuth_coverage_deg < 360
      ? 0
      : 0;

  /**
   * Where a track starts so that it arrives when we want it to.
   *
   * Same reasoning as the exercise generator: put a slow track where a fast
   * one belongs and the designer watches a symbol creep for ten minutes.
   */
  const spawnFor = (speedKts: number, arriveAtS: number) => {
    const km = 3 + knotsToKmPerSecond(speedKts) * arriveAtS;
    return Math.min(Math.max(km, blind + 5), detection * 0.98);
  };

  /* Fixed seed: the test is meant to be run twice and compared, so the codes
     have to be the same both times. The luck of the shooting is seeded per
     attempt elsewhere; the picture itself should not move under the designer. */
  const dice = seededRandom("system-test");

  /* The friendly track is drawn from a class that carries a transponder, if
     the profile declares one. Otherwise the single track meant to show a reply
     coming back is as silent as the rest, and the test demonstrates only half
     of interrogation — which is the half that needs demonstrating least. */
  const cooperating = classes.find(
    (entry) => (entry.transponder ?? "none") !== "none",
  );

  const tracks = Array.from({ length: TRACK_COUNT }, (_, index) => {
    const isFriendlyIndex = index === 2;
    const declared =
      isFriendlyIndex && cooperating
        ? cooperating
        : classes[index % Math.max(classes.length, 1)];
    const speed = declared?.typical_speed_kts.max
      ? Math.max(declared.typical_speed_kts.min, declared.typical_speed_kts.max * 0.8)
      : 420;

    // Spread across the covered arc, and staggered so the picture builds.
    const bearing = (boresight - 40 + index * 20 + 360) % 360;
    const arriveAt = 120 + index * 45;

    /* One friendly among them, and one that only resolves late: the two cases
       a console has to make visually obvious, and the two a designer is most
       likely to get wrong. */
    const isFriendly = isFriendlyIndex;
    const resolvesLate = index === 3;

    /* The friendly one replies, and nothing else does — so the test shows both
       halves of interrogation: a code coming back, and the silence that is the
       harder half. Whether the operator ever sees either depends on the
       profile declaring an interrogator, which is itself worth finding out. */
    const codes = codesFor(
      isFriendly ? (declared?.transponder ?? "civil") : "none",
      dice,
    );

    return {
      designator: `RH-${1100 + index * 11}`,
      classification: declared?.name ?? "aircraft",
      spawn_bearing_deg: bearing,
      spawn_range_km: spawnFor(speed, arriveAt),
      altitude_ft: declared?.typical_altitude_ft.max
        ? Math.round(declared.typical_altitude_ft.max * 0.6)
        : 18000,
      heading_deg: (bearing + 180) % 360,
      speed_kts: Math.round(speed),
      truth_iff: isFriendly ? friendly : hostile,
      initial_iff: isFriendly || resolvesLate ? unknown : hostile,
      // The rehearsal never mis-types a track: the designer is checking
      // their figures, not being set a puzzle.
      initial_classification: "",
      resolves_at_s: resolvesLate ? arriveAt - 30 : isFriendly ? null : null,
      appears_at_s: index === 0 ? 0 : 10 + index * 15,
      mode_3: codes.mode_3,
      mode_1: codes.mode_1,
      notes: isFriendly
        ? "Test: this one is friendly. Engaging it should be counted against you."
        : resolvesLate
          ? "Test: identity resolves late, so the call is yours for most of the run."
          : "Test: a plain inbound.",
    };
  });

  const last = tracks.reduce(
    (latest, track) => Math.max(latest, track.appears_at_s),
    0,
  );

  return {
    exercise_name: "System test",
    situation_brief: [
      "This is your own test of the system, not a training exercise. Nothing is recorded and nobody is scored.",
      "",
      `Five tracks come in across the covered arc and arrive one after another. One of them is friendly and one resolves late, so every identification colour your profile declares appears at some point.`,
      "",
      `What it is worth watching: whether the detection range gives you enough warning to do anything, whether the interceptor actually catches what it is aimed at, and whether the console holds up with a live picture in it — the track list holding its rows, the scope staying square, the firing solution appearing where it will appear for a trainee.`,
      "",
      cooperating
        ? `If your profile declares an IFF interrogator, one of these five replies and the rest stay silent — so interrogating each of them shows you both answers.`
        : `No track class in your profile carries a transponder, so every interrogation here returns silence. If that is not true of the real system, say which classes reply in the profile.`,
      "",
      `Engagement envelope: ${Math.round(envelope)} km. Detection: ${Math.round(detection)} km.`,
    ].join("\n"),
    // Long enough for the last arrival to be dealt with, and capped so a
    // designer is never stuck watching an empty scope.
    time_window_seconds: Math.min(600, Math.max(300, last + 240)),
    radar_boresight_deg: boresight,
    live_tracks: tracks,
    success_criteria: {
      max_leakers: 0,
      max_interceptors_spent: profile?.engagement.magazine_depth ?? 8,
      statement:
        "Nothing is judged here. Fire, hold, or let them through — the system is what is being tested.",
    },
    resources: [],
    tracks: [],
    dilemmas: [],
  };
}
