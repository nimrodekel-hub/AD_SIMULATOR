import type { TransponderKind } from "./schemas";

/**
 * The two transponder codes an interrogator can get back, and their rules.
 *
 * One module because the same rules are needed in four places — the form the
 * designer types codes into, the scenario the model generates, the test
 * scenario built in code, and the console that shows them — and a format
 * enforced in three of the four is a format that quietly breaks in the fourth.
 *
 * **Mode 3/A** is four octal digits, each 0–7. It is the code civil air
 * traffic assigns, and what a co-operating military aircraft squawks as well.
 * **Mode 1** is two digits, each 0–4: a military mission code. A track that
 * answers on Mode 1 is saying something a Mode 3 code alone does not.
 *
 * An empty string is not a missing value — it is **no reply**, which is the
 * answer that matters most: it is what turns an unknown track into a decision.
 */

const MODE_3 = /^[0-7]{4}$/;
const MODE_1 = /^[0-4]{2}$/;

export const isMode3 = (code: string): boolean => MODE_3.test(code);
export const isMode1 = (code: string): boolean => MODE_1.test(code);

/**
 * Keeps a half-typed code legal without fighting the person typing it.
 *
 * Digits outside the range are dropped rather than clamped: someone reaching
 * for 8 on a Mode 3 code has pressed the wrong key, and turning it into a 7
 * would hand them a code they did not choose and would not notice.
 */
export const cleanMode3 = (raw: string): string =>
  raw.replace(/[^0-7]/g, "").slice(0, 4);

export const cleanMode1 = (raw: string): string =>
  raw.replace(/[^0-4]/g, "").slice(0, 2);

/**
 * The Mode 3 codes that mean something everywhere, and what they mean.
 *
 * Worth naming in the console rather than leaving as four digits: an operator
 * who does not recognise 7700 has to be told what it is, and being told during
 * a run is the whole point of a training simulator. All three are octal, so
 * they are legal codes a scenario can legitimately hand out.
 */
export const WELL_KNOWN_MODE_3: Record<string, string> = {
  "7500": "unlawful interference — hijack",
  "7600": "radio failure",
  "7700": "general emergency",
  "1200": "civil VFR, no assigned code",
  "2000": "civil, entering from an area with no assignment",
};

/** What a code means, if it means anything beyond itself. */
export const meaningOfMode3 = (code: string): string | null =>
  WELL_KNOWN_MODE_3[code] ?? null;

/**
 * A plausible code for a track of this class.
 *
 * Deterministic from the caller's own generator, so a run's codes are as
 * repeatable as its luck: a debrief that quotes a code is still quoting the
 * right one when somebody reviews it.
 *
 * The emergency codes are deliberately **not** reachable here. A hijack squawk
 * is a scenario decision — the designer's or the generator's — not something
 * that should turn up by chance in a routine exercise.
 */
export function codesFor(
  kind: TransponderKind,
  random: () => number,
): { mode_3: string; mode_1: string } {
  if (kind === "none") return { mode_3: "", mode_1: "" };

  const octal = () => String(Math.floor(random() * 8));
  const quinary = () => String(Math.floor(random() * 5));

  let mode3 = `${octal()}${octal()}${octal()}${octal()}`;
  // A drawn code that happens to mean something would say it by accident.
  while (WELL_KNOWN_MODE_3[mode3] !== undefined) {
    mode3 = `${octal()}${octal()}${octal()}${octal()}`;
  }

  return {
    mode_3: mode3,
    mode_1: kind === "military" ? `${quinary()}${quinary()}` : "",
  };
}

/** How the console labels a reply, or the absence of one. */
export function describeReply(
  mode3: string,
  mode1: string,
): { text: string; replied: boolean } {
  if (!mode3 && !mode1) return { text: "no reply", replied: false };

  const parts: string[] = [];
  if (mode3) parts.push(`M3 ${mode3}`);
  if (mode1) parts.push(`M1 ${mode1}`);
  return { text: parts.join(" · "), replied: true };
}
