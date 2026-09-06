import { AlertIcon, CheckIcon } from "@/components/icons";
import { gapsFor, type Gap } from "@/lib/domain/profile-readiness";

/**
 * What is missing, said at the field rather than at the foot of the form.
 *
 * The summary panel at the bottom of the profile screen was the only place
 * that named a gap, and it was not enough for the fields that are missing
 * most often. Two reasons. A long form puts thirty inputs between the count
 * and the input it is counting, so "4 things still to complete" is a search
 * rather than a place to stand. And the figures a command runs on — a reload
 * time, the tilt limits — only exist on screen once the checkbox above them
 * is ticked, so a designer could tick a box, scroll past an empty box they
 * had no reason to read as urgent, and be told at the bottom of the page that
 * something was wrong somewhere above.
 *
 * So the same gap now appears twice, and that is the point: red at the input
 * that causes it, and once more in the summary that gates the approval. Both
 * come out of `simulationGaps` — the function that actually refuses — so
 * neither can drift into describing a rule the system does not enforce.
 *
 * Each sentence says what is missing *and what will happen without it*,
 * because "required" on its own is a demand, while "counts as off and no
 * reload control appears" is a reason.
 *
 * Why it is shaped this way, and the three states a command can be in:
 * `docs/missing-figures.md`.
 */
export function GapNotice({
  gaps,
  field,
  className = "",
}: {
  /** Everything wrong with the profile as it currently stands. */
  gaps: Gap[];
  /**
   * The input this notice sits under, or the few that share one row.
   *
   * A row of narrow figures — an interceptor's min, max and speed — has no
   * room for three separate notices under three boxes eight characters wide,
   * so the row names all three keys and the notices stack beneath it in the
   * order the rule raised them.
   */
  field: string | string[];
  className?: string;
}) {
  const keys = Array.isArray(field) ? field : [field];
  const mine = keys.flatMap((key) => gapsFor(gaps, key));
  if (mine.length === 0) return null;

  return (
    <div className={`mt-2 space-y-1.5 ${className}`} role="alert">
      {mine.map((gap, index) => (
        <p
          key={index}
          className="flex items-start gap-1.5 text-xs leading-relaxed text-danger"
        >
          <AlertIcon className="mt-[0.15rem] shrink-0 text-sm" />
          <span>{gap.what}</span>
        </p>
      ))}
    </div>
  );
}

/**
 * Whether a whole section is complete, as a chip beside its heading.
 *
 * Scanning a form for red text works until the red is inside a collapsed
 * command or below the fold. A count on the heading means the section can be
 * skipped or opened on sight, and a green tick is worth as much as a warning:
 * a designer who has just filled six fields in wants to be told that the
 * section is done, not left to infer it from an absence.
 */
export function SectionState({
  gaps,
  where,
}: {
  gaps: Gap[];
  /** The section heading, matched against `Gap.where`. */
  where: string;
}) {
  const mine = gaps.filter((gap) => gap.where === where);

  if (mine.length === 0) {
    return (
      <span
        className="chip status-ok"
        title="Nothing missing in this section"
      >
        <CheckIcon />
        complete
      </span>
    );
  }

  return (
    <span
      className="chip status-danger"
      title={mine.map((gap) => gap.what).join(" ")}
    >
      <AlertIcon />
      {mine.length} to fix
    </span>
  );
}
