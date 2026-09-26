import "server-only";
import { gapMessage, simulationGaps, type Gap } from "@/lib/domain/profile-readiness";
import {
  applyEdits,
  profileDiff,
  type ProfileChange,
  type ProfileEdit,
} from "@/lib/domain/profile-edits";
import {
  SystemProfileDraftSchema,
  type SystemProfile,
  type SystemProfileDraft,
} from "@/lib/domain/schemas";

/**
 * What a set of edits would do to one stored profile — worked out, not saved.
 *
 * Proposing and applying run exactly this, and on purpose: the designer
 * approves the before-and-after they were shown, and the apply step re-runs
 * the same edits against the profile *as it is now* rather than trusting a
 * copy the browser kept. If someone changed the profile in between, an edit
 * that no longer fits fails loudly instead of overwriting their work.
 */
export interface EvaluatedChange {
  /** The profile after the edits, validated. Null when it would not validate. */
  draft: SystemProfileDraft | null;
  changes: ProfileChange[];
  /** Edits that could not be applied at all, and why. */
  failed: Array<{ path: string; reason: string }>;
  /** Why the result is not a valid profile, when it is not. */
  invalid: string[];
  /**
   * Figures the simulation needs that this change would leave missing.
   *
   * Only gaps the change *introduces*. A profile approved before the
   * completeness rule existed can already be short of a figure, and refusing
   * every change to it until that is fixed would make the one easy way of
   * fixing it unusable.
   */
  newGaps: Gap[];
}

/** The behaviour half of a stored profile — what edits are allowed to reach. */
export function draftOf(profile: SystemProfile): SystemProfileDraft {
  const { id, approved, source_answers, created_at, approved_at, ...draft } =
    profile;
  void id;
  void approved;
  void source_answers;
  void created_at;
  void approved_at;
  return draft;
}

export function evaluateChange(
  profile: SystemProfile,
  edits: ProfileEdit[],
): EvaluatedChange {
  const before = draftOf(profile);
  const { next, failed } = applyEdits(before, edits);
  const parsed = SystemProfileDraftSchema.safeParse(next);

  const failures = failed.map(({ edit, reason }) => ({
    path: edit.path,
    reason,
  }));

  if (!parsed.success) {
    return {
      draft: null,
      // Still shown: the designer should see what was attempted, beside why
      // it cannot be saved.
      changes: profileDiff(before, next),
      failed: failures,
      invalid: parsed.error.issues.map(
        (issue) =>
          `${issue.path.map(String).join(" › ") || "profile"}: ${issue.message}`,
      ),
      newGaps: [],
    };
  }

  const had = new Set(
    simulationGaps(before).map((gap) => `${gap.field}|${gap.what}`),
  );
  const newGaps = simulationGaps(parsed.data).filter(
    (gap) => !had.has(`${gap.field}|${gap.what}`),
  );

  return {
    draft: parsed.data,
    changes: profileDiff(before, parsed.data),
    failed: failures,
    invalid: [],
    newGaps,
  };
}

/** The reason an evaluated change cannot be saved, or null if it can. */
export function blockerOf(
  evaluated: EvaluatedChange,
  profile: SystemProfile,
): string | null {
  if (evaluated.failed.length > 0) {
    return `Some of the change could not be applied: ${evaluated.failed
      .map((entry) => `${entry.path} — ${entry.reason}`)
      .join(" ")}`;
  }
  if (!evaluated.draft) {
    return `The result would not be a valid profile: ${evaluated.invalid.join("; ")}`;
  }
  /* An approved profile is what trainees are flying. A change that would take
     away a figure the simulation runs on cannot go straight into it — the
     designer would be told "saved" and every run after would quietly fall back
     to defaults. A draft has no such audience. */
  if (profile.approved && evaluated.newGaps.length > 0) {
    return gapMessage(evaluated.newGaps);
  }
  return null;
}
