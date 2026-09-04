/**
 * The arithmetic the air picture is made of.
 *
 * Everything here is a plain function of numbers so it can be reasoned about
 * and tested without a browser, a clock or a React tree anywhere near it. The
 * simulation's honesty rests on this file: if a track's range and its time to
 * impact disagree, a trainee learns to distrust the display, and the exercise
 * is worse than useless.
 *
 * Convention throughout: the site sits at the origin, +y is north and +x is
 * east, distances are kilometres and bearings are degrees clockwise from north
 * — which is how an operator reads them, and not how `Math.atan2` returns them.
 */

export interface Vec {
  /** East, in km. */
  x: number;
  /** North, in km. */
  y: number;
}

/** Knots to kilometres per second. One knot is 1.852 km/h. */
export function knotsToKmPerSecond(knots: number): number {
  return (knots * 1.852) / 3600;
}

const RAD = Math.PI / 180;

/** Bearing and range as seen by the operator, to a position on the plane. */
export function polarToVec(bearingDeg: number, rangeKm: number): Vec {
  return {
    x: rangeKm * Math.sin(bearingDeg * RAD),
    y: rangeKm * Math.cos(bearingDeg * RAD),
  };
}

/** A position on the plane, back to what the console shows. */
export function vecToPolar(v: Vec): { bearing_deg: number; range_km: number } {
  // atan2(x, y) rather than the usual (y, x): bearings run clockwise from
  // north, so the axes swap and the sign works out without a correction.
  const bearing = Math.atan2(v.x, v.y) / RAD;
  return {
    bearing_deg: (bearing + 360) % 360,
    range_km: Math.hypot(v.x, v.y),
  };
}

/** How far and in what direction something travels in one second. */
export function velocity(headingDeg: number, speedKts: number): Vec {
  const perSecond = knotsToKmPerSecond(speedKts);
  return {
    x: perSecond * Math.sin(headingDeg * RAD),
    y: perSecond * Math.cos(headingDeg * RAD),
  };
}

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(v: Vec, by: number): Vec {
  return { x: v.x * by, y: v.y * by };
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Feet to kilometres, so altitude and range can be compared at all. */
export function feetToKm(feet: number): number {
  return feet * 0.0003048;
}

/**
 * How far above the horizon something sits, seen from the site, in degrees.
 *
 * What a fixed array's tilt is measured against: point it at 6° and anything
 * lower than 6° of elevation is under the beam and not held, however close it
 * is. A track directly overhead is 90°; one on the horizon is 0°.
 */
export function elevationDeg(altitudeFt: number, rangeKm: number): number {
  if (rangeKm <= 0) return 90;
  return (Math.atan2(feetToKm(altitudeFt), rangeKm) * 180) / Math.PI;
}

/**
 * The smallest angle between two bearings, ignoring which way round.
 *
 * Used for arc tests, where 350° and 10° are twenty degrees apart rather than
 * three hundred and forty.
 */
export function bearingDelta(a: number, b: number): number {
  const raw = Math.abs(((a - b) % 360 + 360) % 360);
  return raw > 180 ? 360 - raw : raw;
}

/**
 * Can the radar see this bearing at all?
 *
 * A rotating radar covers everything. A fixed array watches a sector centred
 * on its boresight and is blind behind it — which is the whole reason coverage
 * is worth asking a designer about, because a threat arriving through the gap
 * is a different training problem from one arriving down the middle.
 */
export function withinArc(
  bearingDeg: number,
  boresightDeg: number,
  coverageDeg: number,
): boolean {
  if (coverageDeg >= 360) return true;
  return bearingDelta(bearingDeg, boresightDeg) <= coverageDeg / 2;
}

/**
 * When an interceptor launched now would meet a target flying on steadily.
 *
 * Solves for the time at which the interceptor's reach equals the target's
 * distance from the site — both start at the origin's launcher, so the
 * question is when `speed × t` catches `|target(t)|`. Expanding that gives a
 * quadratic in t; the smaller positive root is the intercept.
 *
 * Returns null when the interceptor is too slow to ever catch it, which is a
 * real outcome and not an error: a fast target crossing away simply cannot be
 * reached, and the operator needs to see that rather than be told a number.
 */
export function timeToIntercept(
  targetAt: Vec,
  targetVelocity: Vec,
  interceptorSpeedKts: number,
): number | null {
  const s = knotsToKmPerSecond(interceptorSpeedKts);

  // |p + v t|² = (s t)²  →  (v·v − s²) t² + 2(p·v) t + p·p = 0
  const a = targetVelocity.x ** 2 + targetVelocity.y ** 2 - s * s;
  const b = 2 * (targetAt.x * targetVelocity.x + targetAt.y * targetVelocity.y);
  const c = targetAt.x ** 2 + targetAt.y ** 2;

  // Interceptor and target equally fast: the quadratic degenerates to a line.
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(b) < 1e-9) return null;
    const t = -c / b;
    return t > 0 ? t : null;
  }

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(
    (t) => t > 0,
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/**
 * Seconds until the track reaches the area it is threatening.
 *
 * Null when it is not closing — a track flying away has no time to impact, and
 * showing one anyway would invent urgency the picture does not contain.
 */
export function timeToImpact(
  at: Vec,
  v: Vec,
  defendedRadiusKm: number,
): number | null {
  // |p + v t| = r, the same quadratic with the interceptor speed replaced by a
  // standing circle around the site.
  const a = v.x ** 2 + v.y ** 2;
  if (a < 1e-12) return null;
  const b = 2 * (at.x * v.x + at.y * v.y);
  const c = at.x ** 2 + at.y ** 2 - defendedRadiusKm ** 2;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)].filter(
    (t) => t > 0,
  );
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/**
 * A repeatable pseudo-random stream.
 *
 * Interception is probabilistic, and probabilistic must not mean unfair: two
 * trainees given the same exercise should meet the same luck, and a debrief
 * that says "your second shot missed" should still be true when the run is
 * reviewed. Seeding from the session id gives both.
 */
export function seededRandom(seed: string): () => number {
  // xmur3 to spread the string into a 32-bit state, then mulberry32 to draw.
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;

  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
