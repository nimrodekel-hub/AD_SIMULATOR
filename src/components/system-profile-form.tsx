"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { GuidedQuestion } from "@/lib/ai/tasks/learn-system";
import {
  emptySpec,
  type SystemSpec,
  SystemSpecFields,
} from "@/components/system-spec-fields";
import type {
  IffState,
  SystemProfile,
  SystemProfileDraft,
  TrackClassification,
} from "@/lib/domain/schemas";
import { simulationGaps, type Gap } from "@/lib/domain/profile-readiness";
import { readJson } from "@/lib/http";

/**
 * Teaching the system how the system works.
 *
 * Two phases. The first collects the specification, in two halves that are
 * deliberately different in kind. Measured things — what the radar sees, which
 * track classes exist and in what bands, which columns the console shows, what
 * the weapon can reach — are typed straight into fields and never shown to a
 * model: a number in a box cannot be misread, and asking a model to find
 * "5 to 40 km" inside a paragraph buys nothing but a chance to get it wrong.
 * Described things — what the system is for, what the operator decides, what
 * happens without them — stay prose, because that is the part where a person
 * writing freely says more than any form would have asked for, and turning
 * prose into lists is what a model is actually good at.
 *
 * Then the extracted profile, fully editable, because this record silently
 * shapes every scenario a trainee will ever see.
 */

type Phase = "answering" | "reviewing";

const TONES: IffState["tone"][] = ["friendly", "neutral", "caution", "hostile"];

export function SystemProfileForm({
  systemId,
  systemName,
  questions,
  existing,
}: {
  systemId: string;
  /** Given by the designer when the system was created; not the model's to change. */
  systemName: string;
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

  /**
   * The measured half, held apart from the answers because it is not an answer.
   * Seeded from an approved profile so editing one is editing, not retyping.
   */
  const [spec, setSpec] = useState<SystemSpec>(() =>
    existing ? toSpec(existing) : emptySpec(),
  );

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
      const response = await fetch(`/api/systems/${systemId}/profile/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: answerList(),
          open_notes: openNotes,
          spec,
        }),
      });
      const payload = await readJson<{ error?: string; draft: SystemProfileDraft }>(
        response,
      );
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
      const response = await fetch(`/api/systems/${systemId}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          source_answers: answerList(),
          approved,
        }),
      });
      const payload = await readJson<{ error?: string }>(response);
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

  /**
   * What is still missing before this can be flown.
   *
   * Computed from whichever copy of the figures is on screen — the entry form
   * holds them in `spec`, the review screen in `draft`, and both are editable,
   * so neither can be treated as the settled one. The same function decides on
   * the server, so the two can never disagree about what "complete" means.
   */
  const gaps = simulationGaps(phase === "answering" ? spec : (draft ?? spec));

  /* ---- Phase 1: the questions ---------------------------------- */
  if (phase === "answering") {
    return (
      <div className="space-y-8">
        <div className="panel p-4">
          <p className="prose-block text-sm">
            Everything here shapes every scenario a trainee will ever see — what
            tracks can appear, what numbers are plausible, what the operator is
            allowed to do.
          </p>
          <p className="mt-2 text-xs text-muted">
            The numbered sections below are the figures: fill them in and they
            reach the knowledge base exactly as you typed them, unread by
            anything. The questions after them are the parts no form can ask
            well — answer those in your own words, and leave blank anything you
            would rather not say. You can correct all of it on the next screen.
          </p>
          <p className="mt-2 text-xs text-muted">
            Anything marked <span className="text-danger">*</span> is a figure
            the simulation runs on and cannot be left empty — with it missing
            the exercise would still run, but on an invented number rather than
            yours, and nothing on screen would say so. Everything else is
            optional: leave blank what you do not know.
          </p>
        </div>

        {/* ---- The measured half: entered, never interpreted ---------- */}
        <SystemSpecFields spec={spec} onChange={setSpec} />

        {/* ---- The described half: still open questions --------------- */}
        <div className="border-t border-line pt-8">
          <h2 className="text-sm font-semibold">In your own words</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            The rest is what a form cannot ask for. Write as much as you like;
            this is the part that gets read carefully.
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

        <MissingData
          gaps={gaps}
          lead="The figures above are what the simulation runs on, so the form cannot be finished until they are complete."
        />

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              busy !== null ||
              gaps.length > 0 ||
              (answeredCount === 0 && !openNotes.trim())
            }
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
        <button
          type="button"
          className="btn"
          onClick={() => {
            // Whatever was corrected here is what the questions should show.
            setSpec({
              sensor: draft.sensor,
              track_classifications: draft.track_classifications,
              iff_states: draft.iff_states,
              iff_interrogation: draft.iff_interrogation,
              track_readout_fields: draft.track_readout_fields,
              engagement: draft.engagement,
            });
            setPhase("answering");
          }}
        >
          Back to the questions
        </button>
      </div>

      <Section
        title="Identity"
        hint={`What ${systemName} is and what it is for.`}
      >
        <Labelled label="Purpose">
          <textarea
            className="field min-h-20"
            value={draft.purpose}
            onChange={(e) => set("purpose", e.target.value)}
          />
        </Labelled>
      </Section>

      {/* ---- Sensor coverage ---------------------------------------- */}
      <Section
        title="What the radar sees"
        hint="Detection range decides how much warning the operator gets; the arc decides whether they get any from a given direction. Both are yours — nothing reads them but the scenario generator."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled label="Detection range (km)">
            <NullableNumber
              value={draft.sensor.max_range_km}
              ariaLabel="Detection range"
              onChange={(max_range_km) =>
                set("sensor", { ...draft.sensor, max_range_km })
              }
            />
          </Labelled>
          <Labelled label="Close-in blind zone (km)">
            <NullableNumber
              value={draft.sensor.min_range_km}
              ariaLabel="Close-in blind zone"
              onChange={(min_range_km) =>
                set("sensor", { ...draft.sensor, min_range_km })
              }
            />
          </Labelled>
          <Labelled label="Azimuth coverage (°)" hint="360 for a rotating radar.">
            <NullableNumber
              value={draft.sensor.azimuth_coverage_deg}
              ariaLabel="Azimuth coverage"
              onChange={(azimuth_coverage_deg) =>
                set("sensor", { ...draft.sensor, azimuth_coverage_deg })
              }
            />
          </Labelled>
          <div>
            <span className="label">Altitude covered (ft)</span>
            {draft.sensor.altitude_ft ? (
              <div className="flex items-center gap-2">
                <NumberInput
                  value={draft.sensor.altitude_ft.min}
                  ariaLabel="Altitude covered minimum"
                  onChange={(min) =>
                    set("sensor", {
                      ...draft.sensor,
                      altitude_ft: { min, max: draft.sensor.altitude_ft!.max },
                    })
                  }
                />
                <span className="text-muted">–</span>
                <NumberInput
                  value={draft.sensor.altitude_ft.max}
                  ariaLabel="Altitude covered maximum"
                  onChange={(max) =>
                    set("sensor", {
                      ...draft.sensor,
                      altitude_ft: { min: draft.sensor.altitude_ft!.min, max },
                    })
                  }
                />
                <RemoveButton
                  label="Clear the altitude band"
                  onClick={() => set("sensor", { ...draft.sensor, altitude_ft: null })}
                />
              </div>
            ) : (
              <AddButton
                label="Give a band"
                onClick={() =>
                  set("sensor", { ...draft.sensor, altitude_ft: { min: 0, max: 0 } })
                }
              />
            )}
          </div>
        </div>
        <Labelled label="Anything the numbers do not carry">
          <textarea
            className="field min-h-20"
            value={draft.sensor.note}
            onChange={(e) => set("sensor", { ...draft.sensor, note: e.target.value })}
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

      <MissingData
        gaps={gaps}
        lead={
          existing?.approved
            ? "This profile was approved before these figures were required. Runs against it are using the simulator's own defaults for whatever is listed here — not this system's numbers. Fill them in under “Back to the questions” at the top of this page, then approve again."
            : "This cannot be approved until the simulation has everything it runs on. Some of it — the rounds, the magazine, how many may be in the air — is entered under “Back to the questions” at the top of this page."
        }
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null || gaps.length > 0}
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
        {gaps.length > 0 ? (
          <span className="text-xs text-muted">
            A draft can still be saved — it just does not drive anything yet.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * What is still missing, said plainly and in one place.
 *
 * Grouped by the section each gap belongs to rather than listed flat: a
 * designer reading this is about to go and fix it, and "four things under the
 * envelope" is a place to stand, where four separate lines about ranges and
 * rounds are a search. The heading text matches the form's own headings
 * exactly, so finding it is scrolling rather than interpreting.
 */
function MissingData({ gaps, lead }: { gaps: Gap[]; lead: string }) {
  if (gaps.length === 0) return null;

  const sections = gaps.reduce<Record<string, string[]>>((grouped, gap) => {
    (grouped[gap.where] ??= []).push(gap.what);
    return grouped;
  }, {});

  return (
    <div className="panel border-l-2 border-l-danger p-4" role="alert">
      <p className="text-sm">
        <strong>
          {gaps.length} thing{gaps.length === 1 ? "" : "s"} still to complete.
        </strong>{" "}
        {lead}
      </p>

      <div className="mt-4 space-y-3">
        {Object.entries(sections).map(([where, items]) => (
          <div key={where}>
            <p className="label !mb-1">{where}</p>
            <ul className="space-y-1">
              {items.map((item, index) => (
                <li key={index} className="text-xs leading-relaxed text-muted">
                  — {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function toDraft(profile: SystemProfile): SystemProfileDraft {
  return {
    purpose: profile.purpose,
    track_classifications: profile.track_classifications,
    iff_states: profile.iff_states,
    iff_interrogation: profile.iff_interrogation,
    track_readout_fields: profile.track_readout_fields,
    sensor: profile.sensor,
    engagement: profile.engagement,
    operator_responsibilities: profile.operator_responsibilities,
    automatic_functions: profile.automatic_functions,
    workflow_steps: profile.workflow_steps,
    general_notes: profile.general_notes,
  };
}

/**
 * The measured half of a profile, pulled back out for editing.
 *
 * Everything here was typed by the designer in the first place, so coming back
 * to the questions shows them what they entered rather than an empty form.
 */
function toSpec(profile: SystemProfile): SystemSpec {
  return {
    sensor: profile.sensor,
    track_classifications: profile.track_classifications,
    iff_states: profile.iff_states,
    iff_interrogation: profile.iff_interrogation,
    track_readout_fields: profile.track_readout_fields,
    engagement: profile.engagement,
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
    transponder: "none",
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

/**
 * The same input, for a figure that may legitimately be unknown.
 *
 * Empty and zero are different answers here: a radar with no stated ceiling is
 * not a radar that sees to zero feet, and storing one as the other would put a
 * limit into the scenario generator that nobody ever claimed.
 */
function NullableNumber({
  value,
  ariaLabel,
  onChange,
}: {
  value: number | null;
  ariaLabel: string;
  onChange: (next: number | null) => void;
}) {
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      className="field data"
      placeholder="—"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
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
