/**
 * Small, exact changes to a behaviour profile, and what they amount to.
 *
 * The profile used to have one way in: a form ten sections long. Anything a
 * designer wanted different about how their system behaves — a class that
 * should reply on Mode 3, a reload that takes twelve seconds — had to be found
 * in that form and typed there. Asking for it in plain words got a polite
 * refusal from the console builder, which is not allowed to touch behaviour,
 * and no other part of the app could act on it at all.
 *
 * The change agent now turns a request into edits, and this module is what
 * makes that safe to accept.
 *
 * **Edits, not a rewritten profile.** Asked for a whole new profile, a model
 * returns one that differs from the old in places nobody asked about — a note
 * reworded, a band nudged, a default filled in — and nothing distinguishes
 * those from the change that was wanted. An edit names one field. Everything
 * it does not name is untouched *by construction*, not by the model's
 * restraint.
 *
 * **Addressed by name, not position.** `track_classifications[Jet].transponder`
 * still means the jet after a class has been added in front of it;
 * `track_classifications[0]` would quietly start meaning something else.
 *
 * **A diff the designer can read before anything is saved.** Every edit is
 * shown as where, before and after, in the words the profile form uses — so
 * the designer approves what will actually change, not the agent's account of
 * it.
 *
 * Deliberately free of imports: the rules here are the ones that decide what
 * gets written to a record trainees are scored against, and they are worth
 * being able to run on their own.
 */

export type EditOp = "set" | "add" | "remove";

export interface ProfileEdit {
  op: EditOp;
  /** e.g. `operator_commands.reload_seconds`, `engagement.interceptors[long range].magazine_max`. */
  path: string;
  /** The new value as JSON. Empty for `remove`. */
  value_json: string;
}

export interface FailedEdit {
  edit: ProfileEdit;
  reason: string;
}

/**
 * What an edit may reach. Everything else on a stored profile is provenance —
 * its id, whether it is approved and when, the interview it came from — and a
 * request in plain words is never a reason to rewrite any of it.
 */
export const EDITABLE_SECTIONS = [
  "purpose",
  "track_classifications",
  "iff_states",
  "track_readout_fields",
  "iff_interrogation",
  "operator_commands",
  "sensor",
  "engagement",
  "operator_responsibilities",
  "automatic_functions",
  "workflow_steps",
  "general_notes",
] as const;

/** Keys that would reach the object machinery rather than the record. */
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

interface Segment {
  key: string;
  /** What is in the brackets after the key, if anything. */
  select: string | null;
}

type Container = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

/**
 * Applies every edit it can, and says why each of the others failed.
 *
 * The source is never modified. A failed edit does not stop the rest: a
 * request with four parts, one of which names a field that does not exist,
 * should still show the designer the three that worked — alongside the one
 * that did not, so it is not mistaken for having been done.
 */
export function applyEdits<T extends object>(
  source: T,
  edits: ProfileEdit[],
): { next: T; failed: FailedEdit[] } {
  const next = structuredClone(source);
  const failed: FailedEdit[] = [];

  for (const edit of edits) {
    const reason = applyOne(next as Container, edit);
    if (reason) failed.push({ edit, reason });
  }

  return { next, failed };
}

/** Returns why the edit could not be applied, or null once it has been. */
function applyOne(root: Container, edit: ProfileEdit): string | null {
  const segments = parsePath(edit.path);
  if (typeof segments === "string") return segments;

  const [first] = segments;
  if (!(EDITABLE_SECTIONS as readonly string[]).includes(first.key)) {
    return `“${first.key}” is not part of the behaviour profile.`;
  }
  if (segments.some((segment) => FORBIDDEN.has(segment.key))) {
    return "That path is not allowed.";
  }

  /* Walk to the container of the last segment. */
  let container: Container = root;
  for (const segment of segments.slice(0, -1)) {
    const child = container[segment.key];
    if (child === undefined) return `There is no “${segment.key}” here.`;

    if (segment.select !== null) {
      if (!Array.isArray(child)) return `“${segment.key}” is not a list.`;
      const index = findIndex(child, segment.select);
      if (index < 0) return notFound(segment.key, segment.select, child);
      const element = child[index];
      if (!isObject(element)) return `“${segment.select}” has no fields.`;
      container = element;
    } else {
      if (!isObject(child)) return `“${segment.key}” has no fields.`;
      container = child;
    }
  }

  const last = segments[segments.length - 1];

  if (edit.op === "remove") {
    if (last.select === null) {
      return "Removing needs the item named in brackets, e.g. track_readout_fields[IFF].";
    }
    const list = container[last.key];
    if (!Array.isArray(list)) return `“${last.key}” is not a list.`;
    const index = findIndex(list, last.select);
    if (index < 0) return notFound(last.key, last.select, list);
    list.splice(index, 1);
    return null;
  }

  const value = parseValue(edit.value_json);

  if (edit.op === "add") {
    if (last.select !== null) {
      return "Adding goes on the list itself, without brackets, e.g. track_readout_fields.";
    }
    const list = container[last.key];
    if (!Array.isArray(list)) return `“${last.key}” is not a list.`;
    list.push(value);
    return null;
  }

  /* set */
  if (last.select !== null) {
    const list = container[last.key];
    if (!Array.isArray(list)) return `“${last.key}” is not a list.`;
    const index = findIndex(list, last.select);
    if (index < 0) return notFound(last.key, last.select, list);
    list[index] = value;
    return null;
  }

  /* A field that does not exist is a typo, not a new field. Writing it would
     be stripped on validation and the edit would vanish — shown to the
     designer as a change that then never happened. */
  if (!(last.key in container)) {
    return `There is no field “${last.key}” here.`;
  }
  container[last.key] = value;
  return null;
}

/**
 * `a.b[Name].c` → segments. Brackets hold a name or an index, and may contain
 * anything but a closing bracket — names like "long range" have spaces.
 */
function parsePath(path: string): Segment[] | string {
  const segments: Segment[] = [];
  let index = 0;
  const text = path.trim();
  if (!text) return "The edit names no field.";

  while (index < text.length) {
    let key = "";
    while (index < text.length && text[index] !== "." && text[index] !== "[") {
      key += text[index++];
    }
    key = key.trim();
    if (!key) return `“${path}” is not a path this can read.`;

    let select: string | null = null;
    if (text[index] === "[") {
      const close = text.indexOf("]", index);
      if (close < 0) return `“${path}” has an unclosed bracket.`;
      select = text.slice(index + 1, close).trim();
      index = close + 1;
    }
    segments.push({ key, select });

    if (index < text.length) {
      if (text[index] !== ".") return `“${path}” is not a path this can read.`;
      index++;
    }
  }
  return segments;
}

/**
 * Finds a list item by its index, its name or label, or — for a list of
 * sentences — its text. Case and surrounding space are ignored: the designer
 * wrote "jet", the profile says "Jet", and they mean the same class.
 */
function findIndex(list: unknown[], select: string): number {
  if (/^\d+$/.test(select)) {
    const at = Number(select);
    return at < list.length ? at : -1;
  }
  const wanted = select.trim().toLowerCase();
  return list.findIndex((item) => nameOf(item)?.trim().toLowerCase() === wanted);
}

function nameOf(item: unknown): string | null {
  if (typeof item === "string") return item;
  if (!isObject(item)) return null;
  const named = item.name ?? item.label;
  return typeof named === "string" ? named : null;
}

function notFound(key: string, select: string, list: unknown[]): string {
  const names = list
    .map(nameOf)
    .filter((name): name is string => !!name && name.length <= 40);
  return names.length > 0
    ? `No “${select}” in ${key}. It has ${names.map((name) => `“${name}”`).join(", ")}.`
    : `No “${select}” in ${key}.`;
}

/**
 * JSON if it is JSON; otherwise the text itself.
 *
 * A model asked for `"military"` will sometimes write `military`. Refusing
 * that would turn a correct change into an error message about quotation
 * marks; taking it as the string it obviously is costs nothing, because the
 * schema check that follows still rejects a value of the wrong kind.
 */
function parseValue(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

function isObject(value: unknown): value is Container {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* Describing                                                          */
/* ------------------------------------------------------------------ */

export interface ProfileChange {
  /** Where, in the form's own words: "Track classes › Jet › Transponder". */
  where: string;
  before: string;
  after: string;
}

/** Section names as the profile form shows them. */
const SECTION_LABELS: Record<string, string> = {
  purpose: "Purpose",
  track_classifications: "Track classes",
  iff_states: "Identification states",
  track_readout_fields: "Track table columns",
  iff_interrogation: "IFF interrogation",
  operator_commands: "Operator commands",
  sensor: "Radar",
  engagement: "Engagement",
  interceptors: "Interceptors",
  operator_responsibilities: "Operator responsibilities",
  automatic_functions: "Automatic functions",
  workflow_steps: "Workflow",
  general_notes: "General notes",
};

const UNITS: Record<string, string> = {
  km: "(km)",
  kts: "(kts)",
  deg: "(°)",
  ft: "(ft)",
};

/**
 * Every difference between two profiles, as lines a designer can check.
 *
 * Lists of named things are compared by name, so adding a class reads as one
 * class added — not as every class after it having changed. Lists of
 * sentences are compared as sets: a responsibility added reads as added, not
 * as the whole list rewritten.
 */
export function profileDiff(before: unknown, after: unknown): ProfileChange[] {
  const changes: ProfileChange[] = [];
  walk(before, after, [], changes);
  return changes;
}

function walk(
  before: unknown,
  after: unknown,
  trail: string[],
  out: ProfileChange[],
): void {
  if (Array.isArray(before) && Array.isArray(after)) {
    walkList(before, after, trail, out);
    return;
  }
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const key of keys) {
      walk(before[key], after[key], [...trail, labelOf(key)], out);
    }
    return;
  }
  if (!same(before, after)) {
    out.push({ where: trail.join(" › "), before: show(before), after: show(after) });
  }
}

function walkList(
  before: unknown[],
  after: unknown[],
  trail: string[],
  out: ProfileChange[],
): void {
  const named = [...before, ...after].every(
    (item) => isObject(item) && nameOf(item) !== null,
  );

  if (named) {
    const key = (item: unknown) => (nameOf(item) ?? "").trim().toLowerCase();
    const old = new Map(before.map((item) => [key(item), item]));
    const now = new Map(after.map((item) => [key(item), item]));

    for (const item of before) {
      const match = now.get(key(item));
      const label = nameOf(item) ?? "";
      if (match === undefined) {
        out.push({ where: [...trail, label].join(" › "), before: "present", after: "removed" });
      } else {
        walk(item, match, [...trail, label], out);
      }
    }
    for (const item of after) {
      if (!old.has(key(item))) {
        out.push({
          where: [...trail, nameOf(item) ?? ""].join(" › "),
          before: "—",
          after: "added",
        });
      }
    }
    return;
  }

  const primitive = [...before, ...after].every((item) => !isObject(item) && !Array.isArray(item));
  if (primitive) {
    const had = new Set(before.map((item) => show(item)));
    const has = new Set(after.map((item) => show(item)));
    for (const item of had) {
      if (!has.has(item)) out.push({ where: trail.join(" › "), before: item, after: "removed" });
    }
    for (const item of has) {
      if (!had.has(item)) out.push({ where: trail.join(" › "), before: "—", after: item });
    }
    return;
  }

  /* Anything else is compared position by position. */
  const length = Math.max(before.length, after.length);
  for (let index = 0; index < length; index++) {
    walk(before[index], after[index], [...trail, String(index + 1)], out);
  }
}

/** `typical_speed_kts` → "Typical speed (kts)"; `mode_3` → "Mode 3". */
function labelOf(key: string): string {
  if (SECTION_LABELS[key]) return SECTION_LABELS[key];
  const words = key.split("_").filter(Boolean);
  const unit = UNITS[words[words.length - 1]];
  if (unit) words.pop();
  const text = words
    .map((word) => (word === "iff" ? "IFF" : word))
    .join(" ");
  const capitalised = text.charAt(0).toUpperCase() + text.slice(1);
  return unit ? `${capitalised} ${unit}` : capitalised;
}

function same(a: unknown, b: unknown): boolean {
  const empty = (value: unknown) => value === null || value === undefined;
  if (empty(a) && empty(b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A value as one short line. */
function show(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return String(value);
  const text =
    typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (!text) return "(empty)";
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}
