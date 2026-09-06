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
  InterceptorType,
  SystemProfile,
  SystemProfileDraft,
  TrackClassification,
  TransponderKind,
} from "@/lib/domain/schemas";
import {
  gapsFor,
  SECTIONS,
  simulationGaps,
  type Gap,
} from "@/lib/domain/profile-readiness";
import { GapNotice, SectionState } from "@/components/gap-notice";
import {
  AlertIcon,
  CheckIcon,
  ColumnsIcon,
  CommandIcon,
  CrossIcon,
  IdentifyIcon,
  InfoIcon,
  LauncherIcon,
  NotesIcon,
  PlusIcon,
  RadarIcon,
  ReloadIcon,
  RetypeIcon,
  RolesIcon,
  TargetIcon,
  TiltIcon,
  TrackIcon,
  TransponderIcon,
} from "@/components/icons";
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
 * shapes every exercise a trainee will ever see.
 */

type Phase = "answering" | "reviewing";

const TONES: IffState["tone"][] = ["friendly", "neutral", "caution", "hostile"];

/**
 * What each answer to "does this class carry a transponder" means.
 *
 * The same three the questions screen offers, worded the same way, because a
 * designer correcting a class here and there is answering one question.
 */
const TRANSPONDERS: Array<{
  value: TransponderKind;
  label: string;
  hint: string;
}> = [
  {
    value: "none",
    label: "No reply",
    hint: "Interrogating it returns silence — which is itself information, and usually the point.",
  },
  {
    value: "civil",
    label: "Civil (Mode 3 only)",
    hint: "Four octal digits, as air traffic assigns. An airliner, a light aircraft, a medevac.",
  },
  {
    value: "military",
    label: "Military (Mode 3 + Mode 1)",
    hint: "Also replies on Mode 1 — two digits, 0–4 — which a civil transponder cannot.",
  },
];

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
          ? "Approved. Exercises and the console are now built from this."
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
            Everything here shapes every exercise a trainee will ever see — what
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
        <SystemSpecFields spec={spec} onChange={setSpec} gaps={gaps} />

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
              onClick={() => {
                /* Carry the figures across.
                   They are the designer's own typing, not something a model
                   has to read, so there is no reason the only bridge from
                   this screen to the profile should be the extraction call.
                   Without this, anyone who corrected a number here and
                   pressed this button watched the correction disappear. */
                setDraft({ ...draft, ...spec });
                setPhase("reviewing");
              }}
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

  const setRound = (index: number, next: InterceptorType) =>
    set("engagement", {
      ...draft.engagement,
      interceptors: replaceAt(draft.engagement.interceptors, index, next),
    });

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
            ? "This is what exercises and the console are built from."
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
              operator_commands: draft.operator_commands,
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
        icon={<NotesIcon />}
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
        icon={<RadarIcon />}
        where={SECTIONS.radar}
        gaps={gaps}
        title={SECTIONS.radar}
        hint="Detection range decides how much warning the operator gets; the arc decides whether they get any from a given direction. Both are yours — nothing reads them but the exercise generator."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled label="Detection range (km)">
            <NullableNumber
              gaps={gaps}
              field="sensor.max_range_km"
              value={draft.sensor.max_range_km}
              ariaLabel="Detection range"
              onChange={(max_range_km) =>
                set("sensor", { ...draft.sensor, max_range_km })
              }
            />
          </Labelled>
          <Labelled label="Close-in blind zone (km)">
            <NullableNumber
              gaps={gaps}
              field="sensor.min_range_km"
              value={draft.sensor.min_range_km}
              ariaLabel="Close-in blind zone"
              onChange={(min_range_km) =>
                set("sensor", { ...draft.sensor, min_range_km })
              }
            />
          </Labelled>
          <Labelled label="Azimuth coverage (°)" hint="360 for a rotating radar.">
            <NullableNumber
              gaps={gaps}
              field="sensor.azimuth_coverage_deg"
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
        icon={<TrackIcon />}
        where={SECTIONS.classes}
        gaps={gaps}
        title={SECTIONS.classes}
        hint="Exercise generation may only produce tracks of these kinds, within these bands."
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
              <GapNotice
                gaps={gaps}
                field={`classes.${index}.name`}
                className="!mt-0 mb-3"
              />

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
                  gaps={gaps}
                  field={`classes.${index}.speed`}
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
                  gaps={gaps}
                  field={`classes.${index}.altitude`}
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

              {/* What this class answers when it is interrogated. Asked only
                  once the system is declared to have an interrogator, since
                  otherwise it is a question about nothing — and it is what
                  decides whether an IFF column ever shows a code. */}
              {draft.iff_interrogation.enabled ? (
                <div className="mt-3">
                  <span className="label">Transponder</span>
                  <div className="flex flex-wrap gap-1">
                    {TRANSPONDERS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        title={option.hint}
                        className={`btn text-xs ${
                          (entry.transponder ?? "none") === option.value
                            ? "btn-primary"
                            : ""
                        }`}
                        onClick={() =>
                          set(
                            "track_classifications",
                            replaceAt(draft.track_classifications, index, {
                              ...entry,
                              transponder: option.value,
                            }),
                          )
                        }
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted">
                    {
                      TRANSPONDERS.find(
                        (option) =>
                          option.value === (entry.transponder ?? "none"),
                      )?.hint
                    }
                  </p>
                </div>
              ) : null}
            </div>
          ))}
          <GapNotice gaps={gaps} field="classes" className="!mt-0" />
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
        icon={<IdentifyIcon />}
        where={SECTIONS.states}
        gaps={gaps}
        title={SECTIONS.states}
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
          <GapNotice gaps={gaps} field="states" className="!mt-0" />
          <AddButton
            label="Add state"
            onClick={() => set("iff_states", [...draft.iff_states, emptyIff()])}
          />
        </div>
      </Section>

      {/* ---- IFF interrogation -------------------------------------- */}
      {/* Sits between the states and the columns because that is what it
          decides: whether an IFF column can ever hold a code, and whether
          the operator gets an interrogate command at all. It was editable
          only on the questions screen, so a designer looking at an empty
          IFF column here had nowhere to turn it on. */}
      <Section
        icon={<TransponderIcon />}
        title="IFF interrogation"
        hint="A separate capability from the radar. With this off the console has no interrogate command and an IFF column reads as a dash — an operator on such a system identifies by behaviour alone, which is a different skill and a deliberate one to train."
      >
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={draft.iff_interrogation.enabled}
            onChange={(e) =>
              set("iff_interrogation", {
                ...draft.iff_interrogation,
                enabled: e.target.checked,
              })
            }
          />
          <span>
            This system has an IFF interrogator.
            <span className="mt-1 block text-xs leading-relaxed text-muted">
              Turning it on asks each track class above what it replies, and
              gives the operator an <strong>Interrogate</strong> command during
              a run.
            </span>
          </span>
        </label>

        {draft.iff_interrogation.enabled ? (
          <>
            <div>
              <span className="label">Which modes it can read</span>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={draft.iff_interrogation.mode_3}
                    onChange={(e) =>
                      set("iff_interrogation", {
                        ...draft.iff_interrogation,
                        mode_3: e.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong className="data">Mode 3/A</strong> — four octal
                    digits, each 0–7
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={draft.iff_interrogation.mode_1}
                    onChange={(e) =>
                      set("iff_interrogation", {
                        ...draft.iff_interrogation,
                        mode_1: e.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong className="data">Mode 1</strong> — two digits, each
                    0–4. A military mission code.
                  </span>
                </label>
              </div>
              {!draft.iff_interrogation.mode_3 &&
              !draft.iff_interrogation.mode_1 ? (
                <p className="mt-2 text-xs text-warn">
                  An interrogator that reads neither mode returns nothing on
                  every track. Choose at least one, or turn interrogation off.
                </p>
              ) : null}
            </div>

            {/* The column has to exist for the reply to land anywhere. */}
            {!draft.track_readout_fields.some((field) =>
              /^iff$/i.test(field.label.trim()),
            ) ? (
              <div className="panel !border-l-2 !border-l-warn p-3">
                <p className="flex items-start gap-2 text-xs leading-relaxed">
                  <InfoIcon className="mt-[0.15rem] shrink-0 text-sm text-warn" />
                  <span>
                    <strong>No IFF column is declared below.</strong> The
                    interrogator will work and the reply will be in the run
                    log, but the track table has nowhere to show it — the
                    table is built from the columns you name.
                  </span>
                </p>
                <AddButton
                  label="Add an IFF column"
                  onClick={() =>
                    set("track_readout_fields", [
                      ...draft.track_readout_fields,
                      {
                        label: "IFF",
                        unit: "",
                        description:
                          "Transponder reply — the Mode 3 code, or that nothing came back. Blank until interrogated.",
                      },
                    ])
                  }
                />
              </div>
            ) : null}

            <Labelled
              label="Anything the boxes do not carry"
              hint="Who may interrogate, when, how long a reply takes."
            >
              <input
                className="field"
                value={draft.iff_interrogation.note}
                onChange={(e) =>
                  set("iff_interrogation", {
                    ...draft.iff_interrogation,
                    note: e.target.value,
                  })
                }
              />
            </Labelled>
          </>
        ) : null}
      </Section>

      {/* ---- What the operator can do ------------------------------- */}
      {/* Selecting, identifying, firing and ceasing exist on every system and
          are not asked about. Everything here is a capability some systems
          have and others do not, and each one the simulator implements as a
          real rule — so switching it on gives the operator the command, and
          leaving it off means the console has no such button rather than a
          button that does nothing. */}
      <Section
        icon={<CommandIcon />}
        where={SECTIONS.commands}
        gaps={gaps}
        title={SECTIONS.commands}
        hint="Beyond selecting a track, identifying it, firing and ceasing — which every system does. Each of these is a rule the simulation enforces, so it costs what it really costs; the console can only offer what is switched on here."
      >
        <Command
          on={draft.operator_commands.retype}
          icon={<RetypeIcon />}
          gaps={gaps}
          field="commands.retype"
          label="Correct the track type"
          why="The system's own typing can be wrong, and putting it right is the operator's call. Needs at least two track classes to choose between — and an exercise only presents a mis-typed track on a system that declares this."
          onToggle={(retype) =>
            set("operator_commands", { ...draft.operator_commands, retype })
          }
        />

        <Command
          on={draft.operator_commands.reload}
          icon={<ReloadIcon />}
          gaps={gaps}
          field="commands.reload_seconds"
          label="Reload during a run"
          why="The magazine can be refilled without ending the run. The clock does not stop for it, which is the whole lesson: a reload buys rounds with the seconds the next track is using to close."
          onToggle={(reload) =>
            set("operator_commands", { ...draft.operator_commands, reload })
          }
        >
          <Labelled
            label="How long a reload takes (s)"
            hint="Leave it truthful. A reload that costs nothing teaches an operator that reloading is free."
          >
            <NullableNumber
              value={draft.operator_commands.reload_seconds}
              ariaLabel="Reload seconds"
              onChange={(reload_seconds) =>
                set("operator_commands", {
                  ...draft.operator_commands,
                  reload_seconds,
                })
              }
            />
          </Labelled>
        </Command>

        <Command
          on={draft.operator_commands.launchers}
          icon={<LauncherIcon />}
          gaps={gaps}
          field="commands.launcher_count"
          label="Choose which launcher fires"
          why="More than one launcher, each holding its own rounds. The magazine above is divided between them, so this adds a decision without adding rounds — an empty or reloading launcher cannot fire, and one with a round in the air cannot be reloaded."
          onToggle={(launchers) =>
            set("operator_commands", { ...draft.operator_commands, launchers })
          }
        >
          <Labelled label="How many launchers" hint="Two or more, or there is nothing to choose.">
            <NullableNumber
              value={draft.operator_commands.launcher_count}
              ariaLabel="Launcher count"
              onChange={(launcher_count) =>
                set("operator_commands", {
                  ...draft.operator_commands,
                  launcher_count,
                })
              }
            />
          </Labelled>
        </Command>

        <Command
          on={draft.operator_commands.tilt}
          icon={<TiltIcon />}
          gaps={gaps}
          field="commands.tilt_min_deg"
          label="Adjust the radar tilt"
          why="A fixed array whose elevation the operator sets. Anything below where it points is not held at all — not on the scope, and not engageable — so raising it to reach something high gives up the low approach."
          onToggle={(tilt) =>
            set("operator_commands", { ...draft.operator_commands, tilt })
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Labelled label="Lowest tilt (°)">
              <NullableNumber
                value={draft.operator_commands.tilt_min_deg}
                ariaLabel="Lowest tilt"
                onChange={(tilt_min_deg) =>
                  set("operator_commands", {
                    ...draft.operator_commands,
                    tilt_min_deg,
                  })
                }
              />
            </Labelled>
            <Labelled label="Highest tilt (°)">
              <NullableNumber
                value={draft.operator_commands.tilt_max_deg}
                ariaLabel="Highest tilt"
                onChange={(tilt_max_deg) =>
                  set("operator_commands", {
                    ...draft.operator_commands,
                    tilt_max_deg,
                  })
                }
              />
            </Labelled>
          </div>
        </Command>

        <Labelled
          label="Anything the switches do not carry"
          hint="A command your system has that is not on this list — say so here. It will not appear in a run, but it is on the record."
        >
          <input
            className="field"
            value={draft.operator_commands.note}
            onChange={(e) =>
              set("operator_commands", {
                ...draft.operator_commands,
                note: e.target.value,
              })
            }
          />
        </Labelled>
      </Section>

      {/* ---- Readout fields ----------------------------------------- */}
      <Section
        icon={<ColumnsIcon />}
        where={SECTIONS.columns}
        gaps={gaps}
        title={SECTIONS.columns}
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
          <GapNotice gaps={gaps} field="columns" className="!mt-0" />
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
        icon={<TargetIcon />}
        where={SECTIONS.envelope}
        gaps={gaps}
        title={SECTIONS.envelope}
        hint="Exercise geometry has to sit inside these, or the trade-off it presents is not a real one."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Labelled label="Minimum range (km)">
              <NumberInput
                wide
                value={draft.engagement.min_range_km}
                ariaLabel="Minimum range"
                onChange={(min_range_km) =>
                  set("engagement", { ...draft.engagement, min_range_km })
                }
              />
            </Labelled>
            <GapNotice gaps={gaps} field="engagement.min_range_km" />
          </div>
          <div>
            <Labelled label="Maximum range (km)">
              <NumberInput
                wide
                value={draft.engagement.max_range_km}
                ariaLabel="Maximum range"
                onChange={(max_range_km) =>
                  set("engagement", { ...draft.engagement, max_range_km })
                }
              />
            </Labelled>
            <GapNotice gaps={gaps} field="engagement.max_range_km" />
          </div>
        </div>

        {/* The three figures the simulation actually enforces.
            They were reachable only from the questions screen, which made
            this page a dead end: it listed them as the reason the profile
            could not be approved and offered nowhere to type them, so the
            approval stayed greyed out however much was corrected here. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Labelled
            label="Interceptors in the air at once"
            hint="The hard limit. A further launch is refused until one resolves."
          >
            <NullableNumber
              gaps={gaps}
              field="engagement.max_simultaneous"
              value={draft.engagement.max_simultaneous}
              ariaLabel="Interceptors in the air at once"
              onChange={(max_simultaneous) =>
                set("engagement", { ...draft.engagement, max_simultaneous })
              }
            />
          </Labelled>
          <Labelled
            label="Rounds available"
            hint="How deep the magazine is for one engagement."
          >
            <NullableNumber
              gaps={gaps}
              field="engagement.magazine_depth"
              value={draft.engagement.magazine_depth}
              ariaLabel="Rounds available"
              onChange={(magazine_depth) =>
                set("engagement", { ...draft.engagement, magazine_depth })
              }
            />
          </Labelled>
        </div>

        <div>
          <span className="label">Interceptor types</span>
          <p className="mb-2 max-w-2xl text-xs leading-relaxed text-muted">
            One entry per round the operator can choose between. A system with
            a single round needs one line. Speed sets the time of flight, which
            is how much earlier than impact the decision has to be made.
          </p>
          <div className="space-y-2">
            {draft.engagement.interceptors.map((round, index) => (
              <div key={index}>
                <div className="flex flex-wrap items-end gap-2">
                  <input
                    className="field data w-40"
                    placeholder="long range"
                    aria-label="Interceptor name"
                    value={round.name}
                    onChange={(e) =>
                      setRound(index, { ...round, name: e.target.value })
                    }
                  />
                  <RoundField
                    label="min km"
                    value={round.min_range_km}
                    onChange={(min_range_km) =>
                      setRound(index, { ...round, min_range_km })
                    }
                  />
                  <RoundField
                    label="max km"
                    wrong={
                      gapsFor(gaps, `interceptors.${index}.max_range_km`).length > 0
                    }
                    value={round.max_range_km}
                    onChange={(max_range_km) =>
                      setRound(index, { ...round, max_range_km })
                    }
                  />
                  <RoundField
                    label="kts"
                    wrong={
                      gapsFor(gaps, `interceptors.${index}.speed_kts`).length > 0
                    }
                    value={round.speed_kts}
                    onChange={(speed_kts) =>
                      setRound(index, { ...round, speed_kts })
                    }
                  />
                  <RemoveButton
                    label={`Remove ${round.name || "interceptor"}`}
                    onClick={() =>
                      set("engagement", {
                        ...draft.engagement,
                        interceptors: removeAt(
                          draft.engagement.interceptors,
                          index,
                        ),
                      })
                    }
                  />
                </div>
                <GapNotice
                  gaps={gaps}
                  field={[
                    `interceptors.${index}.name`,
                    `interceptors.${index}.max_range_km`,
                    `interceptors.${index}.speed_kts`,
                  ]}
                />
              </div>
            ))}
            <GapNotice gaps={gaps} field="interceptors" className="!mt-0" />
            <AddButton
              label="Add an interceptor type"
              onClick={() =>
                set("engagement", {
                  ...draft.engagement,
                  interceptors: [
                    ...draft.engagement.interceptors,
                    {
                      name: "",
                      min_range_km: draft.engagement.min_range_km,
                      max_range_km: draft.engagement.max_range_km,
                      speed_kts: 1600,
                    },
                  ],
                })
              }
            />
          </div>
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
        icon={<RolesIcon />}
        title="Who does what"
        hint="An exercise must never ask a trainee to do something the system does by itself."
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

      <Section
        icon={<NotesIcon />}
        title="General notes"
        hint="Everything that did not fit a field above."
      >
        <textarea
          className="field min-h-32"
          value={draft.general_notes}
          onChange={(e) => set("general_notes", e.target.value)}
        />
      </Section>

      {error ? <p className="chip status-danger !normal-case">{error}</p> : null}
      {notice ? <p className="chip status-ok !normal-case">{notice}</p> : null}

      {gaps.length === 0 ? (
        <NothingMissing approved={existing?.approved === true} />
      ) : null}
      <MissingData
        gaps={gaps}
        lead={
          existing?.approved
            ? "This profile was approved before these figures were required. Runs against it are using the simulator's own defaults for whatever is listed here — not this system's numbers. Every one of them can be filled in on this page; approve again once they are."
            : "This cannot be approved until the simulation has everything it runs on. All of it is on this page, under the headings named below."
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
        {/* What the second button actually does, which is not the same thing
            on a profile that is in force as on one that never was. Saving a
            draft over an approved profile takes the system out of service,
            and that is too large a consequence to leave unsaid. */}
        <span className="min-w-0 flex-1 text-xs text-muted">
          {existing?.approved
            ? "Saving a draft takes this profile out of use until it is approved again — training runs would fall back to the simulator's own defaults."
            : "A draft can still be saved — it just does not drive anything yet."}
        </span>
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
    <div className="panel !border-l-2 !border-l-danger p-4" role="alert">
      <p className="flex items-start gap-2 text-sm">
        <AlertIcon className="mt-[0.2rem] shrink-0 text-base text-danger" />
        <span>
          <strong>
            {gaps.length} thing{gaps.length === 1 ? "" : "s"} still to complete.
          </strong>{" "}
          {lead}
        </span>
      </p>

      <div className="mt-4 space-y-3">
        {Object.entries(sections).map(([where, items]) => (
          <div key={where}>
            <p className="label !mb-1.5">{where}</p>
            <ul className="space-y-1.5">
              {items.map((item, index) => (
                <li
                  key={index}
                  className="flex items-start gap-1.5 text-xs leading-relaxed text-muted"
                >
                  <AlertIcon className="mt-[0.15rem] shrink-0 text-danger" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The other half of the same sentence: nothing is missing.
 *
 * A form that only ever speaks up to complain leaves its quiet state
 * ambiguous — a designer who has just filled in four figures cannot tell
 * whether the warning is gone or whether they have simply not scrolled to it.
 * Saying so costs one line and removes the doubt.
 */
function NothingMissing({ approved }: { approved: boolean }) {
  return (
    <div className="panel !border-l-2 !border-l-ok p-4">
      <p className="flex items-start gap-2 text-sm">
        <CheckIcon className="mt-[0.2rem] shrink-0 text-base text-ok" />
        <span>
          <strong>The simulation has every figure it runs on.</strong>{" "}
          {approved
            ? "Exercises and the console are being built from these numbers."
            : "This can be approved, and then exercises and the console are built from it."}
        </span>
      </p>
    </div>
  );
}

function toDraft(profile: SystemProfile): SystemProfileDraft {
  return {
    purpose: profile.purpose,
    track_classifications: profile.track_classifications,
    iff_states: profile.iff_states,
    iff_interrogation: profile.iff_interrogation,
    operator_commands: profile.operator_commands,
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
    operator_commands: profile.operator_commands,
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

/**
 * One section of the profile, with its heading, icon and state.
 *
 * `where` is the same string `simulationGaps` reports against, and passing it
 * does two things: it puts a count on the heading, and it keeps the heading
 * honest. The summary at the foot of this page names the section to scroll
 * to, and for three sections it used to name one that did not exist here —
 * "What can appear on the display" against a heading reading "Track
 * classifications". Taking both from `SECTIONS` means the words in the
 * summary are the words on the page.
 */
function Section({
  title,
  hint,
  icon,
  where,
  gaps,
  children,
}: {
  title: string;
  hint?: string;
  icon: React.ReactNode;
  where?: string;
  gaps?: Gap[];
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded bg-accent-dim text-base text-accent">
          {icon}
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        {where && gaps ? <SectionState gaps={gaps} where={where} /> : null}
      </div>
      {hint ? (
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">{hint}</p>
      ) : null}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/**
 * One capability, with what it costs said before it is switched on.
 *
 * The reason sits under the label rather than in a tooltip because it is not
 * decoration: a designer deciding whether their system can reload is deciding
 * what their trainees will be taught about scarcity, and "the clock does not
 * stop" is the part of that they need before they tick the box, not after.
 * The figures a command needs appear only once it is on — asking for a reload
 * time on a system that cannot reload is asking about nothing.
 */
function Command({
  on,
  label,
  why,
  icon,
  gaps,
  field,
  onToggle,
  children,
}: {
  on: boolean;
  label: string;
  why: string;
  icon: React.ReactNode;
  gaps: Gap[];
  /** The figure this command runs on, as `simulationGaps` keys it. */
  field: string;
  onToggle: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  const wrong = on && gapsFor(gaps, field).length > 0;

  return (
    <div className={`panel p-4 ${wrong ? "!border-l-2 !border-l-danger" : ""}`}>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={on}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={`grid size-6 shrink-0 place-items-center rounded text-sm ${
                wrong
                  ? "bg-danger-dim text-danger"
                  : on
                    ? "bg-accent-dim text-accent"
                    : "bg-panel-raised text-muted"
              }`}
            >
              {icon}
            </span>
            <span className="font-medium">{label}</span>
            {/* Three states, not two. A command that is on but missing its
                figure behaves exactly like one that is off — the console
                grows no control — and the only place that difference can be
                seen before a trainee flies it is here. */}
            {wrong ? (
              <span className="chip status-danger">
                <AlertIcon />
                needs a figure
              </span>
            ) : on ? (
              <span className="chip status-ok">
                <CheckIcon />
                live
              </span>
            ) : (
              <span className="chip text-muted">off</span>
            )}
          </span>
          <span className="mt-1.5 block max-w-2xl text-xs leading-relaxed text-muted">
            {why}
          </span>
        </span>
      </label>
      {on && children ? <div className="mt-3 space-y-3">{children}</div> : null}
      {on ? <GapNotice gaps={gaps} field={field} /> : null}
    </div>
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
  gaps,
  field,
}: {
  label: string;
  value: { min: number; max: number };
  onChange: (next: { min: number; max: number }) => void;
  gaps?: Gap[];
  field?: string;
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
      {gaps && field ? <GapNotice gaps={gaps} field={field} /> : null}
    </div>
  );
}

function NumberInput({
  value,
  ariaLabel,
  onChange,
  wide,
}: {
  value: number;
  ariaLabel: string;
  onChange: (next: number) => void;
  /** Fills its column instead of sitting at band width. */
  wide?: boolean;
}) {
  return (
    <input
      type="number"
      aria-label={ariaLabel}
      className={`field data ${wide ? "" : "w-28"}`}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** A narrow number with its unit above it, for a row of round figures. */
function RoundField({
  label,
  value,
  onChange,
  wrong,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  /**
   * This is the figure the row's warning is about.
   *
   * The sentence under the row names the round and says what is missing, but
   * three boxes eight characters wide all look equally plausible, and the one
   * that reads `0` is not obviously the wrong one. Reddening the box turns a
   * sentence to be read into a place to look.
   */
  wrong?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[0.625rem] uppercase tracking-[0.1em] text-muted">
        {label}
      </span>
      <input
        type="number"
        className={`field data w-24 ${wrong ? "!border-danger" : ""}`}
        aria-label={label}
        aria-invalid={wrong || undefined}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/**
 * The same input, for a figure that may legitimately be unknown.
 *
 * Empty and zero are different answers here: a radar with no stated ceiling is
 * not a radar that sees to zero feet, and storing one as the other would put a
 * limit into the exercise generator that nobody ever claimed.
 */
function NullableNumber({
  value,
  ariaLabel,
  onChange,
  gaps,
  field,
}: {
  value: number | null;
  ariaLabel: string;
  onChange: (next: number | null) => void;
  gaps?: Gap[];
  /** The key this input answers to in `simulationGaps`. */
  field?: string;
}) {
  const wrong = gaps && field ? gapsFor(gaps, field).length > 0 : false;

  return (
    <>
      <input
        type="number"
        aria-label={ariaLabel}
        aria-invalid={wrong || undefined}
        className={`field data ${wrong ? "!border-danger" : ""}`}
        placeholder="—"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      />
      {gaps && field ? <GapNotice gaps={gaps} field={field} /> : null}
    </>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn text-xs" onClick={onClick}>
      <PlusIcon className="text-sm" />
      {label}
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
      <CrossIcon className="text-sm" />
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
