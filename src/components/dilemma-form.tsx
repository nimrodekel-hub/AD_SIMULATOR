"use client";

import { useState } from "react";
import type {
  Action,
  DecisionPoint,
  DilemmaDraft,
  Range,
} from "@/lib/domain/schemas";

/**
 * The structured record, laid out for review and correction.
 *
 * The brief is specific that the agent must present a real form rather than a
 * summary, and that the designer can edit every field. That is the safety net
 * for the whole system: extraction can misread an expert, and this is where a
 * misreading gets caught — before the entry is approved and starts generating
 * training for other people.
 *
 * Deliberately plain form styling. This screen is read while thinking, not
 * while reacting.
 */

export function DilemmaForm({
  initial,
  saving,
  error,
  primaryLabel,
  onSubmit,
  secondary,
}: {
  initial: DilemmaDraft;
  saving: boolean;
  error?: string;
  primaryLabel: string;
  onSubmit: (draft: DilemmaDraft) => void;
  secondary?: React.ReactNode;
}) {
  const [draft, setDraft] = useState<DilemmaDraft>(initial);

  /** Narrow updater so each field edits one key without clobbering the rest. */
  const set = <K extends keyof DilemmaDraft>(key: K, value: DilemmaDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="space-y-8"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft);
      }}
    >
      {/* ---- Identity ------------------------------------------------ */}
      <Section
        title="Identity"
        hint="How this dilemma is named and filed."
      >
        <Labelled label="Title">
          <input
            className="field"
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            required
          />
        </Labelled>
        <Labelled label="Sub-domain tag">
          <input
            className="field data"
            value={draft.sub_domain_tag}
            onChange={(e) => set("sub_domain_tag", e.target.value)}
            placeholder="multi-threat-prioritization"
            required
          />
        </Labelled>
      </Section>

      {/* ---- Matching surface ---------------------------------------- */}
      <Section
        title="Trigger conditions"
        hint="Read by the matching engine when a trainee asks for training in their own words. The more it sounds like how a trainee would phrase the request, the better the routing."
      >
        <textarea
          className="field min-h-32"
          value={draft.trigger_conditions}
          onChange={(e) => set("trigger_conditions", e.target.value)}
          required
        />
      </Section>

      {/* ---- Key variables ------------------------------------------- */}
      <Section
        title="Key variables"
        hint="The dials scenario generation turns. Every generated run stays inside these bounds."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <RangeField
            label="Threat count"
            value={draft.key_variables.threat_count_range}
            onChange={(threat_count_range) =>
              set("key_variables", {
                ...draft.key_variables,
                threat_count_range,
              })
            }
          />
          <RangeField
            label="Time window (seconds)"
            value={draft.key_variables.time_window_seconds}
            onChange={(time_window_seconds) =>
              set("key_variables", {
                ...draft.key_variables,
                time_window_seconds,
              })
            }
          />
        </div>

        <Labelled
          label="IFF certainty levels"
          hint="Least to most certain, one per line. Generated tracks may only use these."
        >
          <textarea
            className="field data min-h-24"
            value={draft.key_variables.iff_certainty_levels.join("\n")}
            onChange={(e) =>
              set("key_variables", {
                ...draft.key_variables,
                iff_certainty_levels: splitLines(e.target.value),
              })
            }
          />
        </Labelled>

        <Labelled label="Constrained resources">
          <div className="space-y-2">
            {draft.key_variables.resource_levels.map((resource, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <input
                  className="field flex-1 min-w-40"
                  value={resource.name}
                  placeholder="interceptors"
                  onChange={(e) =>
                    set("key_variables", {
                      ...draft.key_variables,
                      resource_levels: replaceAt(
                        draft.key_variables.resource_levels,
                        index,
                        { ...resource, name: e.target.value },
                      ),
                    })
                  }
                />
                <input
                  className="field w-28"
                  value={resource.unit}
                  placeholder="rounds"
                  onChange={(e) =>
                    set("key_variables", {
                      ...draft.key_variables,
                      resource_levels: replaceAt(
                        draft.key_variables.resource_levels,
                        index,
                        { ...resource, unit: e.target.value },
                      ),
                    })
                  }
                />
                <NumberInput
                  value={resource.min}
                  ariaLabel={`${resource.name} minimum`}
                  onChange={(min) =>
                    set("key_variables", {
                      ...draft.key_variables,
                      resource_levels: replaceAt(
                        draft.key_variables.resource_levels,
                        index,
                        { ...resource, min },
                      ),
                    })
                  }
                />
                <span className="text-muted">–</span>
                <NumberInput
                  value={resource.max}
                  ariaLabel={`${resource.name} maximum`}
                  onChange={(max) =>
                    set("key_variables", {
                      ...draft.key_variables,
                      resource_levels: replaceAt(
                        draft.key_variables.resource_levels,
                        index,
                        { ...resource, max },
                      ),
                    })
                  }
                />
                <RemoveButton
                  label={`Remove ${resource.name || "resource"}`}
                  onClick={() =>
                    set("key_variables", {
                      ...draft.key_variables,
                      resource_levels: removeAt(
                        draft.key_variables.resource_levels,
                        index,
                      ),
                    })
                  }
                />
              </div>
            ))}
            <AddButton
              label="Add resource"
              onClick={() =>
                set("key_variables", {
                  ...draft.key_variables,
                  resource_levels: [
                    ...draft.key_variables.resource_levels,
                    { name: "", unit: "", min: 0, max: 0 },
                  ],
                })
              }
            />
          </div>
        </Labelled>
      </Section>

      {/* ---- Decision points ----------------------------------------- */}
      <Section
        title="Decision points"
        hint="The branch points, in the order the trainee meets them. The rationale and common errors here are quoted back verbatim in the debrief — vague text here produces a vague debrief."
      >
        <div className="space-y-4">
          {draft.decision_points.map((point, index) => (
            <DecisionPointEditor
              key={index}
              index={index}
              point={point}
              onChange={(next) =>
                set("decision_points", replaceAt(draft.decision_points, index, next))
              }
              onRemove={() =>
                set("decision_points", removeAt(draft.decision_points, index))
              }
            />
          ))}
          <AddButton
            label="Add decision point"
            onClick={() =>
              set("decision_points", [
                ...draft.decision_points,
                {
                  situation: "",
                  valid_actions: [{ label: "", description: "" }],
                  preferred_action: "",
                  rationale: "",
                  common_errors: [],
                },
              ])
            }
          />
        </div>
      </Section>

      {/* ---- Difficulty ---------------------------------------------- */}
      <Section
        title="Difficulty scaling"
        hint="How the same dilemma tightens. Each band should stay inside the key-variable ranges above."
      >
        <div className="space-y-4">
          {(["easy", "medium", "hard"] as const).map((level) => {
            const band = draft.difficulty_scaling[level];
            return (
              <div key={level} className="panel p-4">
                <p className="mb-3 text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-accent">
                  {level}
                </p>
                <Labelled label="Description">
                  <input
                    className="field"
                    value={band.description}
                    onChange={(e) =>
                      set("difficulty_scaling", {
                        ...draft.difficulty_scaling,
                        [level]: { ...band, description: e.target.value },
                      })
                    }
                  />
                </Labelled>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <RangeField
                    label="Threat count"
                    value={band.threat_count}
                    onChange={(threat_count) =>
                      set("difficulty_scaling", {
                        ...draft.difficulty_scaling,
                        [level]: { ...band, threat_count },
                      })
                    }
                  />
                  <RangeField
                    label="Time window (seconds)"
                    value={band.time_window_seconds}
                    onChange={(time_window_seconds) =>
                      set("difficulty_scaling", {
                        ...draft.difficulty_scaling,
                        [level]: { ...band, time_window_seconds },
                      })
                    }
                  />
                </div>
                <div className="mt-3">
                  <Labelled label="Pressure note">
                    <textarea
                      className="field min-h-20"
                      value={band.pressure_note}
                      onChange={(e) =>
                        set("difficulty_scaling", {
                          ...draft.difficulty_scaling,
                          [level]: { ...band, pressure_note: e.target.value },
                        })
                      }
                    />
                  </Labelled>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---- Evaluation ---------------------------------------------- */}
      <Section
        title="Evaluation criteria"
        hint="What the debrief scores against."
      >
        <Labelled
          label="Success condition"
          hint="Objective enough that a run can be judged pass or fail against it."
        >
          <textarea
            className="field min-h-24"
            value={draft.evaluation_criteria.success_condition}
            onChange={(e) =>
              set("evaluation_criteria", {
                ...draft.evaluation_criteria,
                success_condition: e.target.value,
              })
            }
            required
          />
        </Labelled>
        <Labelled label="Scoring notes">
          <textarea
            className="field min-h-24"
            value={draft.evaluation_criteria.scoring_notes}
            onChange={(e) =>
              set("evaluation_criteria", {
                ...draft.evaluation_criteria,
                scoring_notes: e.target.value,
              })
            }
          />
        </Labelled>
      </Section>

      {error ? (
        <p className="chip status-danger !normal-case">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : primaryLabel}
        </button>
        {secondary}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Decision point                                                      */
/* ------------------------------------------------------------------ */

function DecisionPointEditor({
  index,
  point,
  onChange,
  onRemove,
}: {
  index: number;
  point: DecisionPoint;
  onChange: (next: DecisionPoint) => void;
  onRemove: () => void;
}) {
  const setActions = (valid_actions: Action[]) => {
    // Keep preferred_action pointing at a label that still exists — scoring
    // matches on the exact string, so a stale reference silently breaks it.
    const stillValid = valid_actions.some(
      (action) => action.label === point.preferred_action,
    );
    onChange({
      ...point,
      valid_actions,
      preferred_action: stillValid ? point.preferred_action : "",
    });
  };

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-accent">
          Decision point {index + 1}
        </p>
        <RemoveButton label="Remove decision point" onClick={onRemove} />
      </div>

      <Labelled label="Situation">
        <textarea
          className="field min-h-20"
          value={point.situation}
          onChange={(e) => onChange({ ...point, situation: e.target.value })}
        />
      </Labelled>

      <div className="mt-3">
        <Labelled
          label="Available actions"
          hint="Include defensible wrong answers, not obvious throwaways."
        >
          <div className="space-y-2">
            {point.valid_actions.map((action, actionIndex) => (
              <div key={actionIndex} className="flex flex-wrap items-start gap-2">
                <input
                  className="field w-full sm:w-56"
                  value={action.label}
                  placeholder="Action label"
                  onChange={(e) =>
                    setActions(
                      replaceAt(point.valid_actions, actionIndex, {
                        ...action,
                        label: e.target.value,
                      }),
                    )
                  }
                />
                <input
                  className="field flex-1 min-w-48"
                  value={action.description}
                  placeholder="What this action does"
                  onChange={(e) =>
                    setActions(
                      replaceAt(point.valid_actions, actionIndex, {
                        ...action,
                        description: e.target.value,
                      }),
                    )
                  }
                />
                <RemoveButton
                  label="Remove action"
                  onClick={() =>
                    setActions(removeAt(point.valid_actions, actionIndex))
                  }
                />
              </div>
            ))}
            <AddButton
              label="Add action"
              onClick={() =>
                setActions([...point.valid_actions, { label: "", description: "" }])
              }
            />
          </div>
        </Labelled>
      </div>

      <div className="mt-3">
        <Labelled label="Preferred action">
          <select
            className="field"
            value={point.preferred_action}
            onChange={(e) =>
              onChange({ ...point, preferred_action: e.target.value })
            }
          >
            <option value="">— select —</option>
            {point.valid_actions.map((action, actionIndex) => (
              <option key={actionIndex} value={action.label}>
                {action.label || `(unnamed action ${actionIndex + 1})`}
              </option>
            ))}
          </select>
        </Labelled>
      </div>

      <div className="mt-3">
        <Labelled
          label="Rationale"
          hint="Quoted to the trainee in the debrief. Write it so it stands alone."
        >
          <textarea
            className="field min-h-24"
            value={point.rationale}
            onChange={(e) => onChange({ ...point, rationale: e.target.value })}
          />
        </Labelled>
      </div>

      <div className="mt-3">
        <Labelled label="Common errors" hint="One per line.">
          <textarea
            className="field min-h-20"
            value={point.common_errors.join("\n")}
            onChange={(e) =>
              onChange({ ...point, common_errors: splitLines(e.target.value) })
            }
          />
        </Labelled>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint ? (
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{hint}</p>
      ) : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {hint ? <span className="mb-1.5 block text-xs text-muted">{hint}</span> : null}
      {children}
    </label>
  );
}

function RangeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Range;
  onChange: (next: Range) => void;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <NumberInput
          value={value.min}
          ariaLabel={`${label} minimum`}
          onChange={(min) => onChange({ ...value, min })}
        />
        <span className="text-muted">–</span>
        <NumberInput
          value={value.max}
          ariaLabel={`${label} maximum`}
          onChange={(max) => onChange({ ...value, max })}
        />
      </div>
    </div>
  );
}

function NumberInput({
  value,
  ariaLabel,
  onChange,
}: {
  value: number;
  ariaLabel: string;
  onChange: (next: number) => void;
}) {
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      className="field data w-24"
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn text-xs" onClick={onClick}>
      + {label}
    </button>
  );
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="px-2 py-1 text-muted transition-colors hover:text-danger"
    >
      ✕
    </button>
  );
}

/* ------------------------------------------------------------------ */

/** Textarea-as-list: blank lines are noise, not empty entries. */
function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function replaceAt<T>(items: T[], index: number, next: T): T[] {
  return items.map((item, i) => (i === index ? next : item));
}

function removeAt<T>(items: T[], index: number): T[] {
  return items.filter((_, i) => i !== index);
}
