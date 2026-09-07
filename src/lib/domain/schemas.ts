/**
 * Domain model for the air-defence training simulator.
 *
 * Every schema here does double duty: it validates data on the way in and out of
 * storage, AND it is handed to Claude as a structured-output format. Keeping one
 * definition avoids the classic drift where the prompt and the parser disagree.
 *
 * Note on strictness: structured outputs require closed objects (no additional
 * properties) and explicit `required` lists, so every field below is mandatory.
 * Where a value may legitimately be unknown, the field is a string that the
 * model fills with an explicit "unknown"/"n/a" rather than an optional.
 *
 * ---
 *
 * **This file is a barrel. The definitions live in `schemas/`.**
 *
 * It was one 1,011-line file, and the reason for splitting it is not tidiness.
 * This repository is written through an API that takes whole files rather than
 * diffs, so adding one field to one schema moved all 41 KB — every time. Nine
 * files of four or five kilobytes each mean a change to the exercise model
 * moves the exercise model.
 *
 * Nothing about the shape of the domain changed, and no importer had to change
 * either: `schemas/` sits beside this file rather than replacing it, so
 * `from "../domain/schemas"` still resolves here — a `.ts` file always wins
 * over a directory of the same name — and `export *` hands on every schema,
 * type and constant under the name it always had.
 *
 * Ordered so the file reads top-down the way the domain does: primitives, then
 * what a designer teaches, then what a trainee flies, then what is kept.
 */

export * from "./schemas/primitives";
export * from "./schemas/scenario";
export * from "./schemas/systems";
export * from "./schemas/profile";
export * from "./schemas/gui";
export * from "./schemas/exercise";
export * from "./schemas/matching";
export * from "./schemas/sessions";
export * from "./schemas/knowledge";
