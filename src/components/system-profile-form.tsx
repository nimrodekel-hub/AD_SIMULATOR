"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GuidedQuestion } from "@/lib/ai/tasks/learn-system";
import type {
  IffState,
  SystemProfile,
  SystemProfileDraft,
  TrackClassification,
} from "@/lib/domain/schemas";

/**
 * Teaching the system how the system works.
 *
 * Two phases. First a set of guided questions plus an open section — a
 * specification is better collected by asking for it than by drawing it out of
 * a conversation. Then the extracted profile, fully editable, because this
 * record silently shapes every scenario a trainee will ever see.
 */

type Phase = "answering" | "reviewing";

const TONES: IffState["tone"][] = ["friendly", "neutral", "caution", "hostile"];

export function SystemProfileForm({
  questions,
  existing,
}: {
  questions: GuidedQuestion[];
  existing: SystemProfile | null;
}) {
  const router = useRouter();

  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {};
    for (const entry of existing?.source_answers ?? []) {
      const match = questions.find((q) => q.question === entry.question);
      if (match) seeded[match.id] = entry.answer;
    }
    return seeded;
  });
  const [openNotes, setOpenNotes] = useState("");

  const [draft, setDraft] = useState<SystemProfileDraft | null>(
    existing ? toDraft(existing) : null,
  );
  const [phase, setPhase] = useState<Phase>(existing ? "reviewing" : "answering");

  const [busy, setBusy] = useState<"extracting" | "saving" | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const answerList = () =>
    questions.map((q) => ({ question: q.question, answer: answers[q.id] ?? "" }));

  async function extract() {
    setBusy("extracting");
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch("/api/system/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: answerList(), open_notes: openNotes }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Extraction failed.");
      setDraft(payload.draft as SystemProfileDraft);
      setPhase("reviewing");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Extraction failed.");
    } finally {
      setBusy(null);
    }
  }

  async function save(approved: boolean) {
    if (!draft) return;
    setBusy("saving");
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch("/api/system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          source_answers: answerList(),
          approved,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Save failed.");
      setNotice(
        approved
          ? "Approved. Scenarios and the console are now built from this."
          : "Saved as a draft. Not yet driving anything.",
      );
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  }

  const answeredCount = questions.filter(
    (q) => (answers[q.id] ?? "").trim().length > 0,
  ).length;

  /* ---- Phase 1: the questions ---------------------------------- */
  if (phase === "answering") {
    return (
      <div className="space-y-8">
        <div className="panel p-4">
          <p className="prose-block text-sm">
            Answer what you can in your own words. Everything here shapes every
            scenario a trainee will ever see — what tracks can appear, what
            numbers are plausible, what the operator is allowed to do.
          </p>
          <p className="mt-2 text-xs text-muted">
            You do not have to answer all of them. Anything left blank, the
            system fills in with its best reading of the rest — and you can
            correct it on the next screen.
          </p>
        </div>

        {questions.map((question, index) => (
          <section key={question.id}>
            <h2 className="text-sm font-semibold">
              <span className="mr-2 text-accent">{index + 1}.</span>
              {question.question}
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
              {question.hint}
            </p>
            <textarea
              className="field mt-3 min-h-24"
              placeholder={question.placeholder}
              value={answers[question.id] ?? ""}
              onChange={(event) =>
                setAnswers({ ...answers, [question.id]: event.target.value })
              }
            />
          </section>
        ))}

        <section>
          <h2 className="text-sm font-semibold">Anything else</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            Whatever the questions did not ask about. Vocabulary the operators
            use, quirks of the display, habits and workarounds, anything that
            would confuse someone seeing the system for the first time.
          </p>
          <textarea
            className="field mt-3 min-h-40"
            placeholder="Free text. Write as much as you like."
            value={openNotes}
            onChange={(event) => setOpenNotes(event.target.value)}
          />
        </section>

        {error ? <p className="chip status-danger !normal-case">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null || (answeredCount === 0 && !openNotes.trim())}
            onClick={() => void extract()}
          >
            {busy === "extracting" ? "Reading your answers…" : "Build the profile"}
          </button>
          <span className="text-xs text-muted">
            {answeredCount} of {questions.length} answered
          </span>
          {draft ? (
            <button
              type="button"
              className="btn"
              onClick={() => setPhase("reviewing")}
            >
              Back to the profile
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  /* ---- Phase 2: review what it understood ----------------------- */
  if (!draft) return null;

  const set = <K extends keyof SystemProfileDraft>(
    key: K,
    value: SystemProfileDraft[K],
  ) => setDraft({ ...draft, [key]: value });

  return (
    <div className="space-y-8">
      <div className="panel flex flex-wrap items-center gap-4 p-4">
        <span
          className={`chip ${existing?.approved ? "status-ok" : "status-warn"}`}
        >
          {existing?.approved ? "approved" : "draft"}
        </span>
        <p className="flex-1 text-sm text-muted">
          {existing?.approved
            ? "This is what scenarios and the console are built from."
            : "Not yet driving anything. Approve it to put it into use."}
        </p>
        <button type="button" className="btn" onClick={() => setPhase("answering")}>
          Back to the questions
        </button>
      </div>

      <Section title="Identity" hint="What this system is and what it is for.">
        <Labelled label="Fictional system name">
          <input
            className="field"
            value={draft.system_name_fictional}
            onChange={(e) => set("system_name_fictional", e.target.value)}
          />
        </Labelled>
        <Labelled label="Purpose">
          <textarea
            className="field min-h-20"
            value={draft.purpose}
            onChange={(e) => set("purpose", e.target.value)}
          />
        </Labelled>
      </Section>

      {/* ---- Track classifications ---------------------------------- */}
      <Section
        title="Track classifications"
        hint="Scenario generation may only produce tracks of these kinds, within these bands."
      >
        <div className="space-y-3">
          {draft.track_classifications.map((entry, index) => (
            <div key={index} className="panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <input
                  className="field data w-56"
                  value={entry.name}
                  placeholder="fast air"
                  onChange={(e) =>
                    set(
                      "track_classifications",
                      replaceAt(draft.track_classifications, index, {
                        ...entry,
                        name: e.target.value,
                      }),
                    )
                  }
                />
                <RemoveButton
                  label="Remove classification"
                  onClick={() =>
                    set(
                      "track_classifications",
                      removeAt(draft.track_classifications, index),
                    )
                  }
                />
              </div>

              <Labelled label="Description">
                <input
                  className="field"
                  value={entry.description}
                  onChange={(e) =>
                    set(
                      "track_classifications",
                      replaceAt(draft.track_classifications, index, {
                        ...entry,
                        description: e.target.value,
                      }),
                    )
                  }
                />
              </Labelled>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <RangeField
                  label="Speed (kts)"
                  value={entry.typical_speed_kts}
                  onChange={(typical_speed_kts) =>
                    set(
                      "track_classifications",
                      replaceAt(draft.track_classifications, index, {
                        ...entry,
                        typical_speed_kts,
                      }),
                    )
                  }
                />
                <RangeField
                  label="Altitude (ft)"
                  value={entry.typical_altitude_ft}
                  onChange={(typical_altitude_ft) =>
                    set(
                      "track_classifications",
                      replaceAt(draft.track_classifications, index, {
                        ...entry,
                        typical_altitude_ft,
                      }),
                    )
                  }
                />
              </div>

              <div className="mt-3">
                <Labelled label="How it behaves">
                  <textarea
                    className="field min-h-16"
                    value={entry.behaviour_note}
                    onChange={(e) =>
                      set(
                        "track_classifications",
                        replaceAt(draft.track_classifications, index, {
                          ...entry,
                          behaviour_note: e.target.value,
                        }),
                      )
                    }
                  />
                </Labelled>
              </div>
            </div>
          ))}
          <AddButton
            label="Add classification"
            onClick={() =>
              set("track_classifications", [
                ...draft.track_classifications,
                emptyClassification(),
              ])
            }
          />
        </div>
      </Section>

      {/* ---- Identification states ---------------------------------- */}
      <Section
        title="Identification states"
        hint="The only states a generated track may be in. The tone decides the colour the console shows it in."
      >
        <div className="space-y-2">
          {draft.iff_states.map((entry, index) => (
            <div key={index} className="panel space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="field data w-48"
                  value={entry.name}
                  placeholder="assumed hostile"
                  onChange={(e) =>
                    set(
                      "iff_states",
                      replaceAt(draft.iff_states, index, {
                        ...entry,
                        name: e.target.value,
                      }),
                    )
                  }
                />
                <select
                  className="field w-40"
                  value={entry.tone}
                  aria-label={`Colour tone for ${entry.name}`}
                  onChange={(e) =>
                    set(
                      "iff_states",
                      replaceAt(draft.iff_states, index, {
                        ...entry,
                        tone: e.target.value as IffState["tone"],
                      }),
                    )
                  }
                >
                  {TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {tone}
                    </option>
                  ))}
                </select>
                <span className={`chip ${toneClass(entry.tone)}`}>
                  {entry.name || "preview"}
                </span>
                <RemoveButton
                  label="Remove state"
                  onClick={() =>
                    set("iff_states", removeAt(draft.iff_states, index))
                  }
                />
              </div>
              <Labelled label="What it means">
                <input
                  className="field"
                  value={entry.meaning}
                  onChange={(e) =>
                    set(
                      "iff_states",
                      replaceAt(draft.iff_states, index, {
                        ...entry,
                        meaning: e.target.value,
                      }),
                    )
                  }
                />
              </Labelled>
              <Labelled label="What puts a track into it">
                <input
                  className="field"
                  value={entry.how_determined}
                  onChange={(e) =>
                    set(
                      "iff_states",
                      replaceAt(draft.iff_states, index, {
                        ...entry,
                        how_determined: e.target.value,
                      }),
                    )
                  }
                />
              </Labelled>
            </div>
          ))}
          <AddButton
            label="Add state"
            onClick={() => set("iff_states", [...draft.iff_states, emptyIff()])}
          />
        </div>
      </Section>

      {/* ---- Readout fields ----------------------------------------- */}
      <Section
        title="Track readouts"
        hint="The console's columns, in display order. These become the table the trainee reads."
      >
        <div className="space-y-2">
          {draft.track_readout_fields.map((entry, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input
                className="field data w-28"
                value={entry.label}
                placeholder="RNG"
                onChange={(e) =>
                  set(
                    "track_readout_fields",
                    replaceAt(draft.track_readout_fields, index, {
                      ...entry,
                      label: e.target.value,
                    }),
                  )
                }
              />
              <input
                className="field w-24"
                value={entry.unit}
                placeholder="km"
                onChange={(e) =>
                  set(
                    "track_readout_fields",
                    replaceAt(draft.track_readout_fields, index, {
                      ...entry,
                      unit: e.target.value,
                    }),
                  )
                }
              />
              <input
                className="field min-w-48 flex-1"
                value={entry.description}
                placeholder="Slant range to the track"
                onChange={(e) =>
                  set(
                    "track_readout_fields",
                    replaceAt(draft.track_readout_fields, index, {
                      ...entry,
                      description: e.target.value,
                    }),
                  )
                }
              />
              <RemoveButton
                label="Remove readout"
                onClick={() =>
                  set(
                    "track_readout_fields",
                    removeAt(draft.track_readout_fields, index),
                  )
                }
              />
            </div>
          ))}
          <AddButton
            label="Add readout"
            onClick={() =>
              set("track_readout_fields", [
                ...draft.track_readout_fields,
                { label: "", unit: "", description: "" },
              ])
            }
          />
        </div>
      </Section>

      {/* ---- Engagement --------------------------------------------- */}
      <Section
        title="Engagement constraints"
        hint="Scenario geometry has to sit inside these, or the trade-off it presents is not a real one."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled label="Minimum range (km)">
            <NumberInput
              value={draft.engagement.min_range_km}
              ariaLabel="Minimum range"
              onChange={(min_range_km) =>
                set("engagement", { ...draft.engagement, min_range_km })
              }
            />
          </Labelled>
          <Labelled label="Maximum range (km)">
            <NumberInput
              value={draft.engagement.max_range_km}
              ariaLabel="Maximum range"
              onChange={(max_range_km) =>
                set("engagement", { ...draft.engagement, max_range_km })
              }
            />
          </Labelled>
        </div>
        <Labelled label="Time of flight">
          <input
            className="field"
            value={draft.engagement.time_of_flight_note}
            onChange={(e) =>
              set("engagement", {
                ...draft.engagement,
                time_of_flight_note: e.target.value,
              })
            }
          />
        </Labelled>
        <Labelled label="Simultaneous engagements">
          <input
            className="field"
            value={draft.engagement.simultaneous_engagements_note}
            onChange={(e) =>
              set("engagement", {
                ...draft.engagement,
                simultaneous_engagements_note: e.target.value,
              })
            }
          />
        </Labelled>
        <Labelled label="Authority to engage">
          <textarea
            className="field min-h-20"
            value={draft.engagement.authority_note}
            onChange={(e) =>
              set("engagement", {
                ...draft.engagement,
                authority_note: e.target.value,
              })
            }
          />
        </Labelled>
      </Section>

      {/* ---- Roles ---------------------------------------------------- */}
      <Section
        title="Who does what"
        hint="A scenario must never ask a trainee to do something the system does by itself."
      >
        <Labelled label="The operator decides" hint="One per line.">
          <textarea
            className="field min-h-24"
            value={draft.operator_responsibilities.join("\n")}
            onChange={(e) =>
              set("operator_responsibilities", splitLines(e.target.value))
            }
          />
        </Labelled>
        <Labelled label="The system does automatically" hint="One per line.">
          <textarea
            className="field min-h-24"
            value={draft.automatic_functions.join("\n")}
            onChange={(e) => set("automatic_functions", splitLines(e.target.value))}
          />
        </Labelled>
        <Labelled label="Workflow, in order" hint="One step per line.">
          <textarea
            className="field min-h-24"
            value={draft.workflow_steps.join("\n")}
            onChange={(e) => set("workflow_steps", splitLines(e.target.value))}
          />
        </Labelled>
      </Section>

      <Section title="General notes" hint="Everything that did not fit a field above.">
        <textarea
          className="field min-h-32"
          value={draft.general_notes}
          onChange={(e) => set("general_notes", e.target.value)}
        />
      </Section>

      {error ? <p className="chip status-danger !normal-case">{error}</p> : null}
      {notice ? <p className="chip status-ok !normal-case">{notice}</p> : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => void save(true)}
        >
          {busy === "saving" ? "Saving…" : "Approve profile"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => void save(false)}
        >
          Save as draft
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function toDraft(profile: SystemProfile): SystemProfileDraft {
  return {
    system_name_fictional: profile.system_name_fictional,
    purpose: profile.purpose,
    track_classifications: profile.track_classifications,
    iff_states: profile.iff_states,
    track_readout_fields: profile.track_readout_fields,
    engagement: profile.engagement,
    operator_responsibilities: profile.operator_responsibilities,
    automatic_functions: profile.automatic_functions,
    workflow_steps: profile.workflow_steps,
    general_notes: profile.general_notes,
  };
}

/** Written out so Tailwind sees each literal class name. */
export function toneClass(tone: IffState["tone"]): string {
  switch (tone) {
    case "friendly":
      return "status-ok";
    case "hostile":
      return "status-danger";
    case "caution":
      return "status-warn";
    default:
      return "status-warn";
  }
}

function emptyClassification(): TrackClassification {
  return {
    name: "",
    description: "",
    typical_speed_kts: { min: 0, max: 0 },
    typical_altitude_ft: { min: 0, max: 0 },
    behaviour_note: "",
  };
}

function emptyIff(): IffState {
  return { name: "", meaning: "", how_determined: "", tone: "neutral" };
}

/* ---- Small building blocks --------------------------------------- */

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
  value: { min: number; max: number };
  onChange: (next: { min: number; max: number }) => void;
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
      className="field data w-28"
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
