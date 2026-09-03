/**
 * Records written before "dilemma" became "scenario", read as if they weren't.
 *
 * The terminology change renamed stored field names too, and the records on
 * disk were migrated to match. This is the safety net for anything that
 * migration did not reach: a session written by the old deploy, a record
 * restored from an older commit, a system nobody has opened in a while.
 *
 * Without it a missed record does not fail loudly — it fails *quietly*, as a
 * required field that is suddenly absent, which surfaces as a run that has
 * forgotten which scenario it taught. That is the one outcome worth writing
 * a shim to avoid.
 *
 * Only ever adds the new name where the old one is present; nothing is
 * removed, and a record already carrying the new name is returned untouched.
 */

/** Old stored key → the name it is read under now. */
const RENAMED: ReadonlyArray<readonly [string, string]> = [
  ["dilemma_entry_id", "scenario_entry_id"],
  ["scenario_instance", "exercise_instance"],
  ["scenario_name", "exercise_name"],
  ["decision_points", "dilemmas"],
  ["kb_decision_point_index", "kb_dilemma_index"],
  /* The pre-simulator quiz path. Only old sessions carry these, which is
     exactly why they are here: those are the records least likely to have
     been reached by anything. */
  ["decision_point_index", "dilemma_index"],
];

/**
 * Rewrites old field names to current ones, anywhere in a parsed record.
 *
 * Recursive because the renamed fields are not all top level:
 * `exercise_name` sits inside the exercise, and `kb_dilemma_index` inside
 * each entry of a list inside that.
 */
export function currentNames<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => currentNames(entry)) as unknown as T;
  }
  if (value === null || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(source)) {
    const renamed = RENAMED.find(([from]) => from === key);
    // A record mid-migration may carry both. The current name wins; the old
    // one is dropped rather than allowed to overwrite it.
    const name = renamed ? renamed[1] : key;
    if (renamed && name in source) continue;
    out[name] = currentNames(inner);
  }
  return out as T;
}
