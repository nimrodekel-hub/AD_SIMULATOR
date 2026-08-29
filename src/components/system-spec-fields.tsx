"use client";

import { READOUT_CATALOGUE } from "@/lib/domain/readouts";
import type {
  EngagementDoctrine,
  IffState,
  SensorCoverage,
  TrackClassification,
  TrackReadoutField,
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
  track_readout_fields: TrackReadoutField[];
  engagement: EngagementDoctrine;
}

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
    track_readout_fields: [],
    engagement: {
      min_range_km: 0,
      max_range_km: 0,
      time_of_flight_note: "",
      simultaneous_engagements_note: "",
      authority_note: "",
    },
  };
}

export function SystemSpecFields({
  spec,
  onChange,
}: {
  spec: SystemSpec;
  onChange: (next: SystemSpec) => void;
}) {
  const set = <K extends keyof SystemSpec>(key: K, value: SystemSpec[K]) =>
    onChange({ ...spec, [key]: value });

  const chosenLabels = new Set(
    spec.track_readout_fields.map((field) => field.label.toUpperCase()),
  );

  return (
    <div className="space-y-10">
      {/* ---- Radar ---------------------------------------------------- */}
      <Block
        title="What the radar sees"
        hint="Detection is a different number from engagement, and it is the one that decides how much warning the operator gets. Coverage decides whether they get any warning at all from a given direction — a threat arriving through a blind arc is a different training problem entirely."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Num
            label="Detection range (km)"
            hint="How far out it sees. Not the engagement range."
            value={spec.sensor.max_range_km}
            onChange={(max_range_km) =>
              set("sensor", { ...spec.sensor, max_range_km })
            }
          />
          <Num
            label="Close-in blind zone (km)"
            hint="Leave empty if there is none."
            value={spec.sensor.min_range_km}
            onChange={(min_range_km) =>
              set("sensor", { ...spec.sensor, min_range_km })
            }
          />
        </div>

        <div>
          <span className="label">Azimuth coverage</span>
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
        title="What can appear on the display"
        hint="Scenario generation may only produce tracks of these kinds, inside these bands. A class you leave out is one a trainee will never see."
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
              <div className="grid gap-4 sm:grid-cols-2">
                <Range
                  label="Speed (kts)"
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
            </div>
          ))}
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
                },
              ])
            }
          />
        </div>
      </Block>

      {/* ---- Identification states ------------------------------------ */}
      <Block
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

      {/* ---- Readout columns ------------------------------------------ */}
      <Block
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
                ↑
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
        title="What it can reach"
        hint="Scenario geometry has to sit inside this, or the trade-off it presents is not a real one. The minimum matters as much as the maximum: a threat that gets inside it cannot be engaged at all."
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Labelled label="Maximum intercept range (km)">
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
        </div>

        <Labelled
          label="Interceptors in the air at once"
          hint="How many engagements can run simultaneously, and how deep the magazine is."
        >
          <input
            className="field"
            placeholder="e.g. Two in the air at once, eight rounds on the launcher."
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

function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">{hint}</p>
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

/** A number that may legitimately be unknown, and stays empty when it is. */
function Num({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <Labelled label={label} hint={hint}>
      <input
        type="number"
        className="field data"
        aria-label={label}
        placeholder="—"
        value={value ?? ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : Number(event.target.value))
        }
      />
    </Labelled>
  );
}

function Range({
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
          + Give a band
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
      + {label}
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
      ✕
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
