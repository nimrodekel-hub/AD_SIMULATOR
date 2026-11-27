/**
 * The colours the operator's instruments speak in, and what each one means.
 *
 * Two vocabularies, and they must never borrow from each other.
 *
 * **Identity** says what a track is believed to be. It follows the standard
 * symbology convention — friendly blue, unknown yellow, suspect orange,
 * hostile red — which is also the convention the designer of the first system
 * stated in their own profile ("own forces blue, enemy red"). It used to be
 * the app's status palette instead, so a friendly track was the same green as
 * a successful kill and a hostile was the same red as an error message: the
 * scope was speaking two languages with one set of words.
 *
 * **Band** says which interceptor something belongs to: the envelope ring on
 * the scope, the magazine meter, the selector button, the round in flight. One
 * colour per band, used in all four places, so choosing the long-range round
 * and seeing which ring it reaches and how many are left is one glance rather
 * than three. Band colours are chosen away from every identity colour, so a
 * round in flight is never mistaken for a track.
 *
 * Colour is never the only carrier: identity also has a shape, and a band has
 * a short label. Free of imports, so both rules can be read and run on their
 * own.
 */

export type Tone = "friendly" | "neutral" | "caution" | "hostile";

/** CSS custom properties, defined in `instruments.css`. */
export const IDENTITY: Record<Tone, string> = {
  friendly: "var(--id-friend)",
  neutral: "var(--id-unknown)",
  caution: "var(--id-suspect)",
  hostile: "var(--id-hostile)",
};

const BAND_VARS = [
  "var(--band-1)",
  "var(--band-2)",
  "var(--band-3)",
  "var(--band-4)",
];

export interface Band {
  name: string;
  /** e.g. "LR" for "long range". Shown wherever the colour is. */
  short: string;
  colour: string;
}

/**
 * One colour and one short label per interceptor, longest reach first.
 *
 * Assigned by reach rather than by name, because every system names its
 * rounds differently and "the one that reaches furthest" is the only thing
 * they all share. Stable for a given profile, so a band keeps its colour from
 * one run to the next.
 */
export function bandsOf(
  interceptors: Array<{ name: string; max_range_km: number }>,
): Map<string, Band> {
  const ordered = [...interceptors].sort(
    (a, b) => b.max_range_km - a.max_range_km,
  );
  const bands = new Map<string, Band>();
  ordered.forEach((round, index) => {
    bands.set(round.name, {
      name: round.name,
      short: abbreviate(round.name),
      colour: BAND_VARS[index % BAND_VARS.length],
    });
  });
  return bands;
}

/** "long range" → "LR"; "Patriot" → "PA"; "SR-2" → "SR". */
export function abbreviate(name: string): string {
  const words = name
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}
