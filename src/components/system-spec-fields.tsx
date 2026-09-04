"use client";

import { READOUT_CATALOGUE } from "@/lib/domain/readouts";
import { WELL_KNOWN_MODE_3 } from "@/lib/domain/iff-codes";
import { OPERATOR_COMMANDS_OFF } from "@/lib/domain/schemas";
import { gapsFor, SECTIONS, type Gap } from "@/lib/domain/profile-readiness";
import { GapNotice, SectionState } from "@/components/gap-notice";
import {
  AlertIcon,
  ArrowUpIcon,
  CheckIcon,
  ColumnsIcon,
  CommandIcon,
  CrossIcon,
  IdentifyIcon,
  LauncherIcon,
  PlusIcon,
  RadarIcon,
  ReloadIcon,
  RetypeIcon,
  TargetIcon,
  TiltIcon,
  TrackIcon,
  TransponderIcon,
} from "@/components/icons";
import type {
  EngagementDoctrine,
  IffInterrogation,
  InterceptorType,
  IffState,
  OperatorCommands,
  SensorCoverage,
  TrackClassification,
  TrackReadoutField,
  TransponderKind,
} from "@/lib/domain/schemas";

/**
 * The measured half of a system profile, entered directly.
 *
 * These are the things that have a value rather than a description: how far the
 * radar sees and across what arc, which track classes exist and in what bands,
 * which columns the console shows, what the weapon can reach. They used to be
 * written in prose and read back out by a model, which was slower, cost money,
 * and gave a confident answer whether or not it had understood the sentence.
 *
 * A number typed into a box needs none of that. The model is left with the part
 * it is actually good at — prose into lists — and these values reach the
 * knowledge base exactly as the designer entered them.
 */

export interface SystemSpec {
  sensor: SensorCoverage;
  track_classifications: TrackClassification[];
  iff_states: IffState[];
  iff_interrogation: IffInterrogation;
  /** The commands this console offers beyond the universal four. */
  operator_commands: OperatorCommands;
  track_readout_fields: TrackReadoutField[];
  engagement: EngagementDoctrine;
}

/** What each answer to "does this class carry a transponder" means. */
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

const TONES: IffState["tone"][] = ["friendly", "neutral", "caution", "hostile"];

/** Common arcs, offered as one press. Anything else is typed. */
const ARCS = [
  { deg: 360, label: "360° rotating" },
  { deg: 180, label: "180°" },
  { deg: 120, label: "120° sector" },
  { deg: 90, label: "90° sector" },
];

export function emptySpec(): SystemSpec {
  return {
    sensor: {
      max_range_km: null,
      min_range_km: null,
      azimuth_coverage_deg: null,
      altitude_ft: null,
      note: "",
    },
    track_classifications: [],
    iff_states: [],
    iff_interrogation: { enabled: false, mode_3: true, mode_1: false, note: "" },
    operator_commands: { ...OPERATOR_COMMANDS_OFF },
    track_readout_fields: [],
    engagement: {
      min_range_km: 0,
      max_range_km: 0,
      time_of_flight_note: "",
      simultaneous_engagements_note: "",
      authority_note: "",
      interceptors: [],
      max_simultaneous: null,
      magazine_depth: null,
    },
  };
}

/**
 * Marks a figure the simulation cannot run without.
 *
 * The rule itself lives in `domain/profile-readiness`, which is what actually
 * refuses; this is only the warning shown beforehand. Being told at the bottom
 * of a long form that six fields are missing is worse than being told which
 * six mattered while filling them in.
 */
function Req() {
  return (
    <span className="ml-1 text-danger" title="Required by the simulation">
      *
    </span>
  );
}

export function SystemSpecFields({
  spec,
  onChange,
  gaps,
}: {
  spec: SystemSpec;
  onChange: (next: SystemSpec) => void;
  /**
   * Everything the simulation is still missing, computed by the parent from
   * this same `spec`. Passed in rather than computed here so the count on the
   * button, the summary at the foot of the page and the red text under each
   * input are all reading one list — three copies of the rule would be three
   * chances for the form to demand something the server does not.
   */
  gaps: Gap[];
}) {
  const set = <K extends keyof SystemSpec>(key: K, value: SystemSpec[K]) =>
    onChange({ ...spec, [key]: value });

  const setRound = (index: number, next: InterceptorType) =>
    set("engagement", {
      ...spec.engagement,
      interceptors: at(spec.engagement.interceptors, index, next),
    });

  const chosenLabels = new Set(
    spec.track_readout_fields.map((field) => field.label.toUpperCase()),
  );

  return (
    <div className="space-y-10">
      {/* ---- Radar ---------------------------------------------------- */}
      <Block
        icon={<RadarIcon />}
        where={SECTIONS.radar}
        gaps={gaps}
        title="What the radar sees"
        hint="Detection is a different number from engagement, and it is the one that decides how much warning the operator gets. Coverage decides whether they get any warning at all from a given direction — a threat arriving through a blind arc is a different training problem entirely."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Num
            label="Detection range (km)"
            required
            hint="How far out it sees. Not the engagement range."
            gaps={gaps}
            field="sensor.max_range_km"
            value={spec.sensor.max_range_km}
            onChange={(max_range_km) =>
              set("sensor", { ...spec.sensor, max_range_km })
            }
          />
          <Num
            label="Close-in blind zone (km)"
            hint="Leave empty if there is none."
            gaps={gaps}
            field="sensor.min_range_km"
            value={spec.sensor.min_range_km}
            onChange={(min_range_km) =>
              set("sensor", { ...spec.sensor, min_range_km })
            }
          />
        </div>

        <div>
          <span className="label">
            Azimuth coverage
            <Req />
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {ARCS.map((arc) => (
              <button
                key={arc.deg}
                type="button"
                className={`btn text-xs ${
                  spec.sensor.azimuth_coverage_deg === arc.deg ? "btn-primary" : ""
                }`}
                onClick={() =>
                  set("sensor", { ...spec.sensor, azimuth_coverage_deg: arc.deg })
                }
              >
                {arc.label}
              </button>
            ))}
            <span className="text-xs text-muted">or</span>
            <input
              type="number"
              aria-label="Azimuth coverage in degrees"
              className="field data w-24"
              placeholder="deg"
              value={spec.sensor.azimuth_coverage_deg ?? ""}
              onChange={(event) =>
                set("sensor", {
                  ...spec.sensor,
                  azimuth_coverage_deg:
                    event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </div>
          <GapNotice gaps={gaps} field="sensor.azimuth_coverage_deg" />
        </div>

        <NullableRange
          label="Altitude the radar covers (ft)"
          value={spec.sensor.altitude_ft}
          onChange={(altitude_ft) => set("sensor", { ...spec.sensor, altitude_ft })}
        />

        <label className="block">
          <span className="label">Anything the numbers do not carry</span>
          <textarea
            className="field min-h-20"
            placeholder="e.g. Terrain shadow to the east; low and close is seen late."
            value={spec.sensor.note}
            onChange={(event) =>
              set("sensor", { ...spec.sensor, note: event.target.value })
            }
          />
        </label>
      </Block>

      {/* ---- Track classes -------------------------------------------- */}
      <Block
        required
        icon={<TrackIcon />}
        where={SECTIONS.classes}
        gaps={gaps}
        title="What can appear on the display"
        hint="Exercise generation may only produce tracks of these kinds, inside these bands. A class you leave out is one a trainee will never see."
      >
        <div className="space-y-3">
          {spec.track_classifications.map((entry, index) => (
            <div key={index} className="panel p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  className="field data w-52"
                  placeholder="cruise missile"
                  aria-label="Track class name"
                  value={entry.name}
                  onChange={(event) =>
                    set(
                      "track_classifications",
                      at(spec.track_classifications, index, {
                        ...entry,
                        name: event.target.value,
                      }),
                    )
                  }
                />
                <input
                  className="field min-w-48 flex-1"
                  placeholder="Low, fast, terrain-following."
                  aria-label="Track class description"
                  value={entry.description}
                  onChange={(event) =>
                    set(
                      "track_classifications",
                      at(spec.track_classifications, index, {
                        ...entry,
                        description: event.target.value,
                      }),
                    )
                  }
                />
                <Remove
                  label="Remove class"
                  onClick={() =>
                    set(
                      "track_classifications",
                      spec.track_classifications.filter((_, i) => i !== index),
                    )
                  }
                />
              </div>
              <GapNotice
                gaps={gaps}
                field={`classes.${index}.name`}
                className="!mt-0 mb-3"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Range
                  label="Speed (kts)"
                  gaps={gaps}
                  field={`classes.${index}.speed`}
                  value={entry.typical_speed_kts}
                  onChange={(typical_speed_kts) =>
                    set(
                      "track_classifications",
                      at(spec.track_classifications, index, {
                        ...entry,
                        typical_speed_kts,
                      }),
                    )
                  }
                />
                <Range
                  label="Altitude (ft)"
                  gaps={gaps}
                  field={`classes.${index}.altitude`}
                  value={entry.typical_altitude_ft}
                  onChange={(typical_altitude_ft) =>
                    set(
                      "track_classifications",
                      at(spec.track_classifications, index, {
                        ...entry,
                        typical_altitude_ft,
                      }),
                    )
                  }
                />
              </div>
              <input
                className="field mt-3"
                placeholder="How it behaves on the way in — steady, manoeuvring, terrain-following…"
                aria-label="Behaviour note"
                value={entry.behaviour_note}
                onChange={(event) =>
                  set(
                    "track_classifications",
                    at(spec.track_classifications, index, {
                      ...entry,
                      behaviour_note: event.target.value,
                    }),
                  )
                }
              />

              {/* Which aircraft answer an interrogation. Only asked once the
                  system is declared to have an interrogator — on a system
                  without one it is a question about nothing. */}
              {spec.iff_interrogation.enabled ? (
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
                            at(spec.track_classifications, index, {
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
                    {TRANSPONDERS.find(
                      (option) => option.value === (entry.transponder ?? "none"),
                    )?.hint}
                  </p>
                </div>
              ) : null}
            </div>
          ))}
          <GapNotice gaps={gaps} field="classes" className="!mt-0" />
          <Add
            label="Add a track class"
            onClick={() =>
              set("track_classifications", [
                ...spec.track_classifications,
                {
                  name: "",
                  description: "",
                  typical_speed_kts: { min: 0, max: 0 },
                  typical_altitude_ft: { min: 0, max: 0 },
                  behaviour_note: "",
                  transponder: "none",
                },
              ])
            }
          />
        </div>
      </Block>

      {/* ---- Identification states ------------------------------------ */}
      <Block
        required
        icon={<IdentifyIcon />}
        where={SECTIONS.states}
        gaps={gaps}
        title="Identification states"
        hint="Every state the operator sees, and what puts a track into it. The tone decides the colour the console shows it in, so it has to match how urgency actually reads on the display."
      >
        <div className="space-y-3">
          {spec.iff_states.map((entry, index) => (
            <div key={index} className="panel p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  className="field data w-52"
                  placeholder="assumed hostile"
                  aria-label="Identification state name"
                  value={entry.name}
                  onChange={(event) =>
                    set(
                      "iff_states",
                      at(spec.iff_states, index, {
                        ...entry,
                        name: event.target.value,
                      }),
                    )
                  }
                />
                <select
                  className="field data w-36"
                  aria-label="Tone"
                  value={entry.tone}
                  onChange={(event) =>
                    set(
                      "iff_states",
                      at(spec.iff_states, index, {
                        ...entry,
                        tone: event.target.value as IffState["tone"],
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
                <Remove
                  label="Remove state"
                  onClick={() =>
                    set(
                      "iff_states",
                      spec.iff_states.filter((_, i) => i !== index),
                    )
                  }
                />
              </div>
              <input
                className="field"
                placeholder="What it means."
                aria-label="Meaning"
                value={entry.meaning}
                onChange={(event) =>
                  set(
                    "iff_states",
                    at(spec.iff_states, index, {
                      ...entry,
                      meaning: event.target.value,
                    }),
                  )
                }
              />
              <input
                className="field mt-2"
                placeholder="What has to happen for a track to reach this state."
                aria-label="How it is determined"
                value={entry.how_determined}
                onChange={(event) =>
                  set(
                    "iff_states",
                    at(spec.iff_states, index, {
                      ...entry,
                      how_determined: event.target.value,
                    }),
                  )
                }
              />
            </div>
          ))}
          <GapNotice gaps={gaps} field="states" className="!mt-0" />
          <Add
            label="Add an identification state"
            onClick={() =>
              set("iff_states", [
                ...spec.iff_states,
                { name: "", meaning: "", how_determined: "", tone: "neutral" },
              ])
            }
          />
        </div>
      </Block>

      {/* ---- IFF interrogation ---------------------------------------- */}
      <Block
        icon={<TransponderIcon />}
        title="Can the operator interrogate a transponder?"
        hint="A separate capability from the radar. Plenty of systems see a track without being able to ask it anything, and an operator on such a system identifies by behaviour alone — a different skill, and a deliberate one to train. Leave this off and the console has no interrogate command at all."
      >
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={spec.iff_interrogation.enabled}
            onChange={(event) =>
              set("iff_interrogation", {
                ...spec.iff_interrogation,
                enabled: event.target.checked,
              })
            }
          />
          <span>
            This system has an IFF interrogator.
            <span className="mt-1 block text-xs leading-relaxed text-muted">
              With this on, each track class below is asked what it replies —
              and the operator gets an <strong>Interrogate</strong> command
              during a run.
            </span>
          </span>
        </label>

        {spec.iff_interrogation.enabled ? (
          <>
            <div className="mt-5">
              <span className="label">Which modes it can read</span>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={spec.iff_interrogation.mode_3}
                    onChange={(event) =>
                      set("iff_interrogation", {
                        ...spec.iff_interrogation,
                        mode_3: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong className="data">Mode 3/A</strong> — four octal
                    digits, each 0–7
                    <span className="mt-0.5 block text-xs text-muted">
                      The code civil air traffic assigns, and what a
                      co-operating military aircraft squawks as well. Almost
                      every interrogator has it.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={spec.iff_interrogation.mode_1}
                    onChange={(event) =>
                      set("iff_interrogation", {
                        ...spec.iff_interrogation,
                        mode_1: event.target.checked,
                      })
                    }
                  />
                  <span>
                    <strong className="data">Mode 1</strong> — two digits, each
                    0–4
                    <span className="mt-0.5 block text-xs text-muted">
                      A military mission code. A track that answers on it is
                      saying something a Mode 3 code alone does not.
                    </span>
                  </span>
                </label>
              </div>
              {!spec.iff_interrogation.mode_3 &&
              !spec.iff_interrogation.mode_1 ? (
                <p className="mt-2 text-xs text-warn">
                  An interrogator that reads neither mode returns nothing on
                  every track. Choose at least one, or turn interrogation off.
                </p>
              ) : null}
            </div>

            <input
              className="field mt-4"
              placeholder="Anything the boxes do not carry — who may interrogate, when, how long a reply takes…"
              aria-label="Interrogation note"
              value={spec.iff_interrogation.note}
              onChange={(event) =>
                set("iff_interrogation", {
                  ...spec.iff_interrogation,
                  note: event.target.value,
                })
              }
            />

            {/* Worth knowing before an exercise hands one out: these codes say
                something specific, the console names them to the trainee, and
                a generated exercise only uses them on purpose. */}
            {spec.iff_interrogation.mode_3 ? (
              <p className="mt-3 text-xs leading-relaxed text-muted">
                Codes that mean something in their own right, which exercises
                use only deliberately:{" "}
                {Object.entries(WELL_KNOWN_MODE_3).map(
                  ([code, meaning], index) => (
                    <span key={code}>
                      {index > 0 ? "; " : ""}
                      <span className="data text-primary">{code}</span> {meaning}
                    </span>
                  ),
                )}
                .
              </p>
            ) : null}
          </>
        ) : null}
      </Block>

      {/* ---- The commands beyond the universal four -------------------- */}
      {/* Asked here as well as on the review screen, because a capability
          that can only be declared after an extraction is a capability a new
          system cannot have until it has been through the model once. */}
      <Block
        icon={<CommandIcon />}
        where={SECTIONS.commands}
        gaps={gaps}
        title="What else can the operator do?"
        hint="Selecting a track, identifying it, firing and ceasing exist on every system and are not asked about. These are the ones that differ — each is a rule the simulation enforces, so it costs what it really costs, and the console can only offer what is switched on here. Leave off anything your system does not have."
      >
        <SpecCommand
          on={spec.operator_commands.retype}
          icon={<RetypeIcon />}
          gaps={gaps}
          field="commands.retype"
          label="Correct the track type"
          why="The system's own typing can be wrong, and putting it right is the operator's call. An exercise only shows a mis-typed track on a system that declares this."
          onToggle={(retype) =>
            set("operator_commands", { ...spec.operator_commands, retype })
          }
        />

        <SpecCommand
          on={spec.operator_commands.reload}
          icon={<ReloadIcon />}
          gaps={gaps}
          field="commands.reload_seconds"
          label="Reload during a run"
          why="The magazine can be refilled without ending the run. The clock does not stop for it, which is the whole lesson: a reload buys rounds with the seconds the next track is using to close."
          onToggle={(reload) =>
            set("operator_commands", { ...spec.operator_commands, reload })
          }
        >
          <Num
            label="How long a reload takes (s)"
            hint="Leave it truthful. A reload that costs nothing teaches an operator that reloading is free."
            value={spec.operator_commands.reload_seconds}
            onChange={(reload_seconds) =>
              set("operator_commands", {
                ...spec.operator_commands,
                reload_seconds,
              })
            }
          />
        </SpecCommand>

        <SpecCommand
          on={spec.operator_commands.launchers}
          icon={<LauncherIcon />}
          gaps={gaps}
          field="commands.launcher_count"
          label="Choose which launcher fires"
          why="More than one launcher, each holding its own rounds. The magazine is divided between them, so this adds a decision without adding rounds — an empty or reloading launcher cannot fire, and one with a round in the air cannot be reloaded."
          onToggle={(launchers) =>
            set("operator_commands", { ...spec.operator_commands, launchers })
          }
        >
          <Num
            label="How many launchers"
            hint="Two or more, or there is nothing to choose."
            value={spec.operator_commands.launcher_count}
            onChange={(launcher_count) =>
              set("operator_commands", {
                ...spec.operator_commands,
                launcher_count,
              })
            }
          />
        </SpecCommand>

        <SpecCommand
          on={spec.operator_commands.tilt}
          icon={<TiltIcon />}
          gaps={gaps}
          field="commands.tilt_min_deg"
          label="Adjust the radar tilt"
          why="A fixed array whose elevation the operator sets. Anything below where it points is not held at all — not on the scope, and not engageable — so raising it to reach something high gives up the low approach."
          onToggle={(tilt) =>
            set("operator_commands", { ...spec.operator_commands, tilt })
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Num
              label="Lowest tilt (°)"
              value={spec.operator_commands.tilt_min_deg}
              onChange={(tilt_min_deg) =>
                set("operator_commands", {
                  ...spec.operator_commands,
                  tilt_min_deg,
                })
              }
            />
            <Num
              label="Highest tilt (°)"
              value={spec.operator_commands.tilt_max_deg}
              onChange={(tilt_max_deg) =>
                set("operator_commands", {
                  ...spec.operator_commands,
                  tilt_max_deg,
                })
              }
            />
          </div>
        </SpecCommand>

        <input
          className="field"
          placeholder="A command your system has that is not on this list — say so here…"
          aria-label="Operator commands note"
          value={spec.operator_commands.note}
          onChange={(event) =>
            set("operator_commands", {
              ...spec.operator_commands,
              note: event.target.value,
            })
          }
        />
      </Block>

      {/* ---- Readout columns ------------------------------------------ */}
      <Block
        required
        icon={<ColumnsIcon />}
        where={SECTIONS.columns}
        gaps={gaps}
        title="What the operator reads for each track"
        hint="Tick the columns your display shows, then put them in the order it shows them. Add anything of your own that is not offered — these become the table a trainee reads, so a missing column is information they never get."
      >
        <div className="flex flex-wrap gap-2">
          {READOUT_CATALOGUE.map((candidate) => {
            const chosen = chosenLabels.has(candidate.label.toUpperCase());
            return (
              <button
                key={candidate.label}
                type="button"
                className={`btn text-xs ${chosen ? "btn-primary" : ""}`}
                onClick={() =>
                  set(
                    "track_readout_fields",
                    chosen
                      ? spec.track_readout_fields.filter(
                          (field) =>
                            field.label.toUpperCase() !==
                            candidate.label.toUpperCase(),
                        )
                      : [...spec.track_readout_fields, { ...candidate }],
                  )
                }
              >
                {chosen ? "✓ " : "+ "}
                {candidate.label}
                {candidate.unit ? ` (${candidate.unit})` : ""}
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          {spec.track_readout_fields.map((entry, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-xs text-muted">{index + 1}.</span>
              <input
                className="field data w-32"
                placeholder="RNG"
                aria-label="Column label"
                value={entry.label}
                onChange={(event) =>
                  set(
                    "track_readout_fields",
                    at(spec.track_readout_fields, index, {
                      ...entry,
                      label: event.target.value,
                    }),
                  )
                }
              />
              <input
                className="field w-20"
                placeholder="km"
                aria-label="Unit"
                value={entry.unit}
                onChange={(event) =>
                  set(
                    "track_readout_fields",
                    at(spec.track_readout_fields, index, {
                      ...entry,
                      unit: event.target.value,
                    }),
                  )
                }
              />
              <input
                className="field min-w-40 flex-1"
                placeholder="What it shows"
                aria-label="Description"
                value={entry.description}
                onChange={(event) =>
                  set(
                    "track_readout_fields",
                    at(spec.track_readout_fields, index, {
                      ...entry,
                      description: event.target.value,
                    }),
                  )
                }
              />
              <button
                type="button"
                aria-label="Move up"
                title="Move up"
                className="px-2 py-1 text-muted transition-colors hover:text-accent disabled:opacity-30"
                disabled={index === 0}
                onClick={() =>
                  set(
                    "track_readout_fields",
                    swap(spec.track_readout_fields, index, index - 1),
                  )
                }
              >
                <ArrowUpIcon className="text-sm" />
              </button>
              <Remove
                label="Remove column"
                onClick={() =>
                  set(
                    "track_readout_fields",
                    spec.track_readout_fields.filter((_, i) => i !== index),
                  )
                }
              />
            </div>
          ))}
          <GapNotice gaps={gaps} field="columns" className="!mt-0" />
          <Add
            label="Add a column of your own"
            onClick={() =>
              set("track_readout_fields", [
                ...spec.track_readout_fields,
                { label: "", unit: "", description: "" },
              ])
            }
          />
        </div>
      </Block>

      {/* ---- Engagement envelope -------------------------------------- */}
      <Block
        icon={<TargetIcon />}
        where={SECTIONS.envelope}
        gaps={gaps}
        title="What it can reach"
        hint="Exercise geometry has to sit inside this, or the trade-off it presents is not a real one. The minimum matters as much as the maximum: a threat that gets inside it cannot be engaged at all."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Labelled label="Minimum intercept range (km)">
              <input
                type="number"
                className="field data"
                aria-label="Minimum intercept range"
                value={spec.engagement.min_range_km}
                onChange={(event) =>
                  set("engagement", {
                    ...spec.engagement,
                    min_range_km: Number(event.target.value),
                  })
                }
              />
            </Labelled>
            <GapNotice gaps={gaps} field="engagement.min_range_km" />
          </div>
          <div>
            <Labelled label="Maximum intercept range (km)" required>
              <input
                type="number"
                className="field data"
                aria-label="Maximum intercept range"
                value={spec.engagement.max_range_km}
                onChange={(event) =>
                  set("engagement", {
                    ...spec.engagement,
                    max_range_km: Number(event.target.value),
                  })
                }
              />
            </Labelled>
            <GapNotice gaps={gaps} field="engagement.max_range_km" />
          </div>
        </div>

        {/* The two figures the simulation enforces. These used to live inside
            the sentence below, which was fine while a run was a quiz: "no more
            than two rockets in the air" has to be a number before anything can
            stop a third launch. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Num
            label="Interceptors in the air at once"
            required
            hint="The hard limit. A third launch is refused until one resolves."
            gaps={gaps}
            field="engagement.max_simultaneous"
            value={spec.engagement.max_simultaneous}
            onChange={(max_simultaneous) =>
              set("engagement", { ...spec.engagement, max_simultaneous })
            }
          />
          <Num
            label="Rounds available"
            required
            hint="How deep the magazine is for one engagement."
            gaps={gaps}
            field="engagement.magazine_depth"
            value={spec.engagement.magazine_depth}
            onChange={(magazine_depth) =>
              set("engagement", { ...spec.engagement, magazine_depth })
            }
          />
        </div>

        {/* ---- The rounds themselves ------------------------------- */}
        <div>
          <span className="label">
            Interceptor types
            <Req />
          </span>
          <p className="mb-2 text-xs leading-relaxed text-muted">
            One entry per round the operator can choose between. A system with
            a single round needs one line; where there are several, picking the
            right one becomes a real decision — a long-range round spent close
            in is a round that is not there for the next threat. Speed sets the
            time of flight, which is how much earlier than impact the operator
            has to commit.
          </p>
          <div className="space-y-2">
            {spec.engagement.interceptors.map((round, index) => (
              <div key={index}>
                <div className="flex flex-wrap items-end gap-2">
                  <input
                    className="field data w-40"
                    placeholder="long range"
                    aria-label="Interceptor name"
                    value={round.name}
                    onChange={(event) =>
                      setRound(index, { ...round, name: event.target.value })
                    }
                  />
                  <RoundNumber
                    label="min km"
                    value={round.min_range_km}
                    onChange={(min_range_km) =>
                      setRound(index, { ...round, min_range_km })
                    }
                  />
                  <RoundNumber
                    label="max km"
                    wrong={
                      gapsFor(gaps, `interceptors.${index}.max_range_km`).length > 0
                    }
                    value={round.max_range_km}
                    onChange={(max_range_km) =>
                      setRound(index, { ...round, max_range_km })
                    }
                  />
                  <RoundNumber
                    label="kts"
                    wrong={
                      gapsFor(gaps, `interceptors.${index}.speed_kts`).length > 0
                    }
                    value={round.speed_kts}
                    onChange={(speed_kts) => setRound(index, { ...round, speed_kts })}
                  />
                  <Remove
                    label="Remove interceptor"
                    onClick={() =>
                      set("engagement", {
                        ...spec.engagement,
                        interceptors: spec.engagement.interceptors.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  />
                </div>
                {/* One notice for the row: three boxes eight characters wide
                    have nowhere to put three separate warnings. */}
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
            <Add
              label="Add an interceptor type"
              onClick={() =>
                set("engagement", {
                  ...spec.engagement,
                  interceptors: [
                    ...spec.engagement.interceptors,
                    {
                      name: "",
                      min_range_km: spec.engagement.min_range_km,
                      max_range_km: spec.engagement.max_range_km,
                      speed_kts: 1600,
                    },
                  ],
                })
              }
            />
          </div>
        </div>

        <Labelled
          label="Anything else about firing several at once"
          hint="The rule in your own words, where the numbers above do not carry it."
        >
          <input
            className="field"
            placeholder="e.g. A third engagement cannot begin until one resolves as hit, kill or miss."
            value={spec.engagement.simultaneous_engagements_note}
            onChange={(event) =>
              set("engagement", {
                ...spec.engagement,
                simultaneous_engagements_note: event.target.value,
              })
            }
          />
        </Labelled>

        <Labelled
          label="Time of flight"
          hint="How long the interceptor takes to arrive — which is how much earlier than impact the decision has to be made."
        >
          <input
            className="field"
            placeholder="e.g. Roughly 25 seconds to mid-range."
            value={spec.engagement.time_of_flight_note}
            onChange={(event) =>
              set("engagement", {
                ...spec.engagement,
                time_of_flight_note: event.target.value,
              })
            }
          />
        </Labelled>

        <Labelled
          label="Who may authorise an engagement"
          hint="Normal authority, and what shifts it — declared states, self-defence, loss of communications."
        >
          <textarea
            className="field min-h-20"
            placeholder="e.g. Battery commander normally; the operator alone under a declared air-defence emergency."
            value={spec.engagement.authority_note}
            onChange={(event) =>
              set("engagement", {
                ...spec.engagement,
                authority_note: event.target.value,
              })
            }
          />
        </Labelled>
      </Block>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * One section of the form, with its own heading, icon and state.
 *
 * The icon is the second way of naming the section, never the only one — a
 * dish and an arc mean "radar" to someone who already knew. What it buys is
 * scanning: seven headings of the same weight down a long page are a wall,
 * and a tinted glyph gives the eye somewhere to land when coming back to fix
 * one figure.
 *
 * The chip is the part that does work. `where` names the section in
 * `simulationGaps`, so the heading itself can say whether anything below it
 * is outstanding — which matters most for the section whose fields only
 * appear once a checkbox is ticked, and would otherwise hide its own red text.
 */
function Block({
  title,
  hint,
  required,
  icon,
  where,
  gaps,
  children,
}: {
  title: string;
  hint: string;
  required?: boolean;
  icon: React.ReactNode;
  /** The matching heading in `simulationGaps`, where the section has one. */
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
        <h2 className="text-sm font-semibold">
          {title}
          {required ? <Req /> : null}
        </h2>
        {where && gaps ? <SectionState gaps={gaps} where={where} /> : null}
      </div>
      <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">{hint}</p>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Labelled({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required ? <Req /> : null}
      </span>
      {hint ? <span className="mb-1.5 block text-xs text-muted">{hint}</span> : null}
      {children}
    </label>
  );
}

/**
 * One capability, with what it costs said before it is switched on.
 *
 * The reason sits under the label rather than in a tooltip because it is not
 * decoration: deciding whether the system can reload is deciding what its
 * trainees will be taught about scarcity, and "the clock does not stop" is
 * the part of that needed before the box is ticked. The figures a command
 * runs on appear only once it is on — asking how long a reload takes on a
 * system that cannot reload is asking about nothing.
 *
 * Which creates the failure this card is now shaped around. Ticking the box
 * reveals a figure, an empty figure means the engine treats the command as
 * absent, and the console then shows no control — so the honest outcome of
 * ticking a box and stopping there is *nothing happens*, silently. The card
 * says which of the three states it is in on its own border and in its own
 * chip: off, live, or on-but-incomplete. Red before it is saved, rather than
 * a shrug on the console afterwards.
 */
function SpecCommand({
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
          onChange={(event) => onToggle(event.target.checked)}
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

/**
 * A number that may legitimately be unknown, and stays empty when it is.
 *
 * It carries its own warning where one is passed, because the alternative is
 * every call site remembering to put a notice underneath — and the field most
 * likely to be forgotten is exactly the one that only appears after a
 * checkbox is ticked.
 */
function Num({
  label,
  hint,
  required,
  value,
  onChange,
  gaps,
  field,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  value: number | null;
  onChange: (next: number | null) => void;
  gaps?: Gap[];
  /** The key this input answers to in `simulationGaps`. */
  field?: string;
}) {
  const wrong = gaps && field ? gapsFor(gaps, field).length > 0 : false;

  return (
    <div>
      <Labelled label={label} hint={hint} required={required}>
        <input
          type="number"
          className={`field data ${wrong ? "!border-danger" : ""}`}
          aria-label={label}
          aria-invalid={wrong || undefined}
          placeholder="—"
          value={value ?? ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? null : Number(event.target.value))
          }
        />
      </Labelled>
      {gaps && field ? <GapNotice gaps={gaps} field={field} /> : null}
    </div>
  );
}

/** A narrow number with its unit under it, for a row of round figures. */
function RoundNumber({
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
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function Range({
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
        <input
          type="number"
          className="field data w-28"
          aria-label={`${label} minimum`}
          value={value.min}
          onChange={(event) =>
            onChange({ ...value, min: Number(event.target.value) })
          }
        />
        <span className="text-muted">–</span>
        <input
          type="number"
          className="field data w-28"
          aria-label={`${label} maximum`}
          value={value.max}
          onChange={(event) =>
            onChange({ ...value, max: Number(event.target.value) })
          }
        />
      </div>
      {gaps && field ? <GapNotice gaps={gaps} field={field} /> : null}
    </div>
  );
}

/** A range that may be unknown entirely, rather than zero to zero. */
function NullableRange({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { min: number; max: number } | null;
  onChange: (next: { min: number; max: number } | null) => void;
}) {
  if (value === null) {
    return (
      <div>
        <span className="label">{label}</span>
        <button
          type="button"
          className="btn text-xs"
          onClick={() => onChange({ min: 0, max: 0 })}
        >
          <PlusIcon className="text-sm" />
          Give a band
        </button>
      </div>
    );
  }

  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="field data w-28"
          aria-label={`${label} minimum`}
          value={value.min}
          onChange={(event) =>
            onChange({ ...value, min: Number(event.target.value) })
          }
        />
        <span className="text-muted">–</span>
        <input
          type="number"
          className="field data w-28"
          aria-label={`${label} maximum`}
          value={value.max}
          onChange={(event) =>
            onChange({ ...value, max: Number(event.target.value) })
          }
        />
        <Remove label="Clear the band" onClick={() => onChange(null)} />
      </div>
    </div>
  );
}

function Add({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn text-xs" onClick={onClick}>
      <PlusIcon className="text-sm" />
      {label}
    </button>
  );
}

function Remove({ label, onClick }: { label: string; onClick: () => void }) {
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

function at<T>(items: T[], index: number, next: T): T[] {
  return items.map((item, i) => (i === index ? next : item));
}

function swap<T>(items: T[], a: number, b: number): T[] {
  const next = [...items];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
