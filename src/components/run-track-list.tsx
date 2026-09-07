"use client";

import { describeReply, meaningOfMode3 } from "@/lib/domain/iff-codes";
import {
  positionOf,
  probabilityOfKill,
  toneOf,
  type RuntimeTrack,
  type SimState,
  type TrackView,
  type simConfig,
} from "@/lib/sim/engine";
import { timeToIntercept, vecToPolar } from "@/lib/sim/geometry";

/**
 * The air picture as a table, in whatever columns this console declares.
 *
 * Split out of `live-run.tsx`, which had grown to 48 KB — and every touch of
 * it moved all 48 KB, because this repository is written through an API that
 * takes whole files rather than diffs. The seam is a real one: nothing here
 * holds state or knows the run exists, it only renders what it is handed.
 */

const TONE_CLASS = {
  friendly: "status-ok",
  neutral: "status-warn",
  caution: "status-warn",
  hostile: "status-danger",
} as const;

export function Clock({
  remaining,
  window: total,
}: {
  remaining: number;
  window: number;
}) {
  const seconds = Math.ceil(remaining);
  const urgency =
    remaining <= total * 0.25
      ? "status-danger"
      : remaining <= total * 0.5
        ? "status-warn"
        : "status-ok";
  return (
    <span className={`chip ${urgency} data`}>
      T-{String(Math.floor(seconds / 60)).padStart(2, "0")}:
      {String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

/**
 * The columns whose values the simulation can actually produce.
 *
 * Matched on the label the designer typed, upper-cased, so the catalogue they
 * ticked from lines up without a second identifier to keep in step. A column
 * outside this set is still shown — it is their console and they may have
 * reasons — but with a dash and a tooltip, because a blank cell reads as a
 * value of nothing rather than as a figure the simulator does not hold.
 */
const KNOWN_READOUTS = new Set([
  "TRK",
  "ID",
  "TYPE",
  "CLASS",
  "AZ",
  "BRG",
  "RNG",
  "ALT",
  "SPD",
  "TTI",
  "IFF",
  "MODE 1",
  "MODE1",
  "PK",
  "FIRE STATUS",
]);

/** Which way a column reads. Numbers right, words left, as a console does. */
const RIGHT_ALIGNED = new Set([
  "AZ",
  "BRG",
  "RNG",
  "ALT",
  "SPD",
  "TTI",
  "PK",
]);

export function TrackList({
  views,
  config,
  state,
  round,
  selected,
  onSelect,
}: {
  views: TrackView[];
  config: ReturnType<typeof simConfig>;
  /** For the columns that describe an engagement rather than a track. */
  state: SimState;
  /** The round currently selected, which is what a Pk column is about. */
  round: string;
  selected: string | null;
  onSelect: (designator: string) => void;
}) {
  if (views.length === 0) {
    return (
      <p className="p-3 text-xs text-muted">
        Nothing held. The scope is clear.
      </p>
    );
  }

  return (
    <table className="data w-full text-[0.7rem]">
      <thead className="sticky top-0 bg-panel text-muted">
        <tr className="border-b border-line">
          {config.readouts.map((field, index) => (
            <th
              key={`${field.label}-${index}`}
              title={field.description || undefined}
              className={`px-2 py-1 font-medium ${
                RIGHT_ALIGNED.has(field.label.toUpperCase())
                  ? "text-right"
                  : "text-left"
              }`}
            >
              {field.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {views.map((view) => (
          <tr
            key={view.track.designator}
            onClick={() => onSelect(view.track.designator)}
            className={`cursor-pointer border-b border-line/60 ${
              view.track.designator === selected ? "bg-panel-raised" : ""
            }`}
          >
            {config.readouts.map((field, index) => (
              <td
                key={`${field.label}-${index}`}
                className={`px-2 py-1 ${
                  RIGHT_ALIGNED.has(field.label.toUpperCase())
                    ? "text-right"
                    : ""
                }`}
              >
                <Readout
                  field={field.label}
                  view={view}
                  config={config}
                  state={state}
                  round={round}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One cell: whatever this console calls this column, as it stands now. */
function Readout({
  field,
  view,
  config,
  state,
  round,
}: {
  field: string;
  view: TrackView;
  config: ReturnType<typeof simConfig>;
  state: SimState;
  round: string;
}) {
  const track = view.track;

  switch (field.trim().toUpperCase()) {
    case "TRK":
      return <>{track.designator}</>;

    /* What the console believes, not what the track is. The two differ only
       on a system that can be wrong about it and lets the operator say so. */
    case "TYPE":
    case "CLASS":
      return (
        <span className={track.typed_by_operator ? "text-accent" : undefined}>
          {track.displayed_classification}
        </span>
      );

    case "AZ":
    case "BRG":
      return <>{view.bearing_deg.toFixed(0)}</>;

    case "RNG":
      return <>{view.range_km.toFixed(0)}</>;

    case "ALT":
      return <>{track.altitude_ft.toLocaleString()}</>;

    case "SPD":
      return <>{track.speed_kts}</>;

    case "TTI":
      return <>{view.tti_s === null ? "—" : `${view.tti_s.toFixed(0)}s`}</>;

    case "ID":
      return (
        <span
          className={`chip ${TONE_CLASS[toneOf(config, track.displayed_iff)]}`}
        >
          {track.displayed_iff}
        </span>
      );

    /* The whole point of the column: a code, silence, or the fact that
       nobody has asked yet — never one standing in for another. */
    case "IFF":
      return config.iff.enabled ? (
        <Squawk track={track} config={config} />
      ) : (
        <span className="text-muted" title="This system has no interrogator">
          —
        </span>
      );

    case "MODE 1":
    case "MODE1":
      if (!config.iff.enabled || !config.iff.mode_1) {
        return (
          <span className="text-muted" title="This system does not read Mode 1">
            —
          </span>
        );
      }
      if (!track.squawk_known) {
        return <span className="text-muted" title="Not interrogated">·</span>;
      }
      return track.mode_1 ? (
        <span className="text-ok">{track.mode_1}</span>
      ) : (
        <span className="text-warn">—</span>
      );

    case "PK": {
      const chosen =
        config.interceptors.find((r) => r.name === round) ??
        config.interceptors[0];
      if (!chosen) return <>—</>;
      const flight = timeToIntercept(view.at, track.velocity, chosen.speed_kts);
      if (flight === null) return <span className="text-danger">—</span>;
      const meetsAt = vecToPolar(
        positionOf(track, state.t + flight),
      ).range_km;
      const pk = probabilityOfKill(meetsAt, chosen);
      return (
        <span
          className={pk > 0.7 ? "text-ok" : pk > 0 ? "text-warn" : "text-danger"}
        >
          {(pk * 100).toFixed(0)}
        </span>
      );
    }

    case "FIRE STATUS": {
      if (track.state === "destroyed") return <span className="text-ok">KILL</span>;
      if (track.state === "leaked") return <span className="text-danger">LEAK</span>;
      const inFlight = state.engagements.some(
        (e) => e.target === track.designator && !e.resolved,
      );
      if (inFlight) return <span className="text-warn">IN FLIGHT</span>;
      const spent = state.engagements.some(
        (e) => e.target === track.designator,
      );
      return spent ? <span className="text-muted">MISS</span> : <>—</>;
    }

    default:
      /* Declared by the designer, and nothing in the simulation produces it.
         Said as a dash with a reason rather than left blank, so it reads as
         "no value here" instead of as a value. */
      return (
        <span
          className="text-muted"
          title={
            KNOWN_READOUTS.has(field.trim().toUpperCase())
              ? "No value for this yet"
              : `The simulation holds no figure called “${field}”`
          }
        >
          —
        </span>
      );
  }
}

/**
 * What the transponder said, or the fact that nobody has asked.
 *
 * Three states, and the difference between the last two is the whole point:
 * not interrogated, interrogated and silent, interrogated and answering. A
 * console that showed a blank for both of the first two would be telling the
 * operator that a track refused to reply when in fact nobody asked it.
 */
export function Squawk({
  track,
  config,
}: {
  track: RuntimeTrack;
  config: ReturnType<typeof simConfig>;
}) {
  if (!track.squawk_known) {
    return <span className="text-muted" title="Not interrogated">·</span>;
  }

  const mode3 = config.iff.mode_3 ? track.mode_3 : "";
  const mode1 = config.iff.mode_1 ? track.mode_1 : "";
  const reply = describeReply(mode3, mode1);

  if (!reply.replied) {
    return (
      <span className="text-warn" title="Interrogated — nothing came back">
        NO RPLY
      </span>
    );
  }

  const meaning = meaningOfMode3(mode3);
  return (
    <span
      className={meaning ? "text-danger" : "text-ok"}
      title={meaning ?? "Transponder reply"}
    >
      {mode3 || `M1 ${mode1}`}
    </span>
  );
}
