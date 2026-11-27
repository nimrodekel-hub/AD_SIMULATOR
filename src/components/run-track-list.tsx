"use client";

import type { CSSProperties } from "react";
import { describeReply, meaningOfMode3 } from "@/lib/domain/iff-codes";
import { bandsOf, IDENTITY, type Tone } from "@/lib/ops-palette";
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
 *
 * Read like an instrument, not like a spreadsheet. Each row carries its
 * identity colour down its left edge, so the list can be scanned for "what is
 * red" without reading a word; a time to impact under a minute is marked,
 * because that column decides the order of work; and the IFF column's colour
 * says what a reply means, not just that there was one.
 */

/** Time to impact, in seconds, below which a track is the next problem. */
const URGENT_S = 60;

export function Clock({
  remaining,
  window: total,
}: {
  remaining: number;
  window: number;
}) {
  const seconds = Math.ceil(remaining);
  const fraction = total > 0 ? remaining / total : 0;
  const urgency =
    fraction <= 0.1 ? "critical" : fraction <= 0.25 ? "low" : fraction <= 0.5 ? "half" : "normal";
  const colour = {
    normal: "var(--ops-phosphor)",
    half: "var(--id-unknown)",
    low: "var(--id-suspect)",
    critical: "var(--id-hostile)",
  }[urgency];

  return (
    <span
      className="ops-root ops-clock"
      data-urgency={urgency}
      style={{ "--c": colour } as CSSProperties}
      role="timer"
      aria-label={`${seconds} seconds left`}
    >
      <span className="ops-label">T−</span>
      <span className="ops-clock-digits">
        {String(Math.floor(seconds / 60)).padStart(2, "0")}:
        {String(seconds % 60).padStart(2, "0")}
      </span>
      <span className="ops-bar" style={{ width: 56 }}>
        <span style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }} />
      </span>
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
const RIGHT_ALIGNED = new Set(["AZ", "BRG", "RNG", "ALT", "SPD", "TTI", "PK"]);

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
      <div className="ops-root grid h-full place-items-center p-4 text-center">
        <div>
          <p className="ops-label">No tracks held</p>
          <p className="ops-dim mt-1 text-[10px]">The picture is clear.</p>
        </div>
      </div>
    );
  }

  return (
    <table className="ops-root ops-table">
      <thead>
        <tr>
          {config.readouts.map((field, index) => (
            <th
              key={`${field.label}-${index}`}
              title={field.description || undefined}
              className={RIGHT_ALIGNED.has(field.label.toUpperCase()) ? "num" : undefined}
            >
              {field.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {views.map((view) => {
          const tone = toneOf(config, view.track.displayed_iff) as Tone;
          return (
            <tr
              key={view.track.designator}
              onClick={() => onSelect(view.track.designator)}
              aria-selected={view.track.designator === selected}
              style={{ "--c": IDENTITY[tone] } as CSSProperties}
            >
              {config.readouts.map((field, index) => (
                <td
                  key={`${field.label}-${index}`}
                  className={
                    RIGHT_ALIGNED.has(field.label.toUpperCase()) ? "num" : undefined
                  }
                >
                  <Readout
                    field={field.label}
                    view={view}
                    tone={tone}
                    config={config}
                    state={state}
                    round={round}
                  />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** One cell: whatever this console calls this column, as it stands now. */
function Readout({
  field,
  view,
  tone,
  config,
  state,
  round,
}: {
  field: string;
  view: TrackView;
  tone: Tone;
  config: ReturnType<typeof simConfig>;
  state: SimState;
  round: string;
}) {
  const track = view.track;

  switch (field.trim().toUpperCase()) {
    case "TRK":
      return (
        <span className="ops-value" style={{ color: IDENTITY[tone] }}>
          {track.designator}
        </span>
      );

    /* What the console believes, not what the track is. The two differ only
       on a system that can be wrong about it and lets the operator say so. */
    case "TYPE":
    case "CLASS":
      return (
        <span style={track.typed_by_operator ? { color: "var(--ops-phosphor)" } : undefined}>
          {track.displayed_classification}
        </span>
      );

    case "AZ":
    case "BRG":
      return <>{String(Math.round(view.bearing_deg) % 360).padStart(3, "0")}</>;

    case "RNG":
      return <>{view.range_km.toFixed(1)}</>;

    case "ALT":
      return <>{track.altitude_ft.toLocaleString()}</>;

    case "SPD":
      return <>{track.speed_kts}</>;

    case "TTI":
      return view.tti_s === null ? (
        <span className="ops-dim">—</span>
      ) : (
        <span className={view.tti_s < URGENT_S ? "ops-urgent" : undefined}>
          {view.tti_s.toFixed(0)}s
        </span>
      );

    case "ID":
      return (
        <span className="ops-tag" style={{ "--c": IDENTITY[tone] } as CSSProperties}>
          {track.displayed_iff}
        </span>
      );

    /* The whole point of the column: a code, silence, or the fact that
       nobody has asked yet — never one standing in for another. */
    case "IFF":
      return config.iff.enabled ? (
        <Squawk track={track} config={config} />
      ) : (
        <span className="ops-dim" title="This system has no interrogator">
          —
        </span>
      );

    case "MODE 1":
    case "MODE1":
      if (!config.iff.enabled || !config.iff.mode_1) {
        return (
          <span className="ops-dim" title="This system does not read Mode 1">
            —
          </span>
        );
      }
      if (!track.squawk_known) {
        return <span className="ops-dim" title="Not interrogated">·</span>;
      }
      return track.mode_1 ? (
        <span style={{ color: "var(--id-friend)" }}>{track.mode_1}</span>
      ) : (
        <span style={{ color: "var(--id-unknown)" }}>—</span>
      );

    case "PK": {
      const chosen =
        config.interceptors.find((r) => r.name === round) ?? config.interceptors[0];
      if (!chosen) return <>—</>;
      const flight = timeToIntercept(view.at, track.velocity, chosen.speed_kts);
      if (flight === null) return <span style={{ color: "var(--id-hostile)" }}>—</span>;
      const meetsAt = vecToPolar(positionOf(track, state.t + flight)).range_km;
      const pk = probabilityOfKill(meetsAt, chosen);
      return <span style={{ color: pkColour(pk) }}>{(pk * 100).toFixed(0)}</span>;
    }

    case "FIRE STATUS": {
      if (track.state === "destroyed") {
        return <span className="ops-tag" style={{ "--c": "var(--kill)" } as CSSProperties}>Kill</span>;
      }
      if (track.state === "leaked") {
        return <span className="ops-tag" style={{ "--c": "var(--id-hostile)" } as CSSProperties}>Leak</span>;
      }
      const flying = state.engagements.find(
        (e) => e.target === track.designator && !e.resolved,
      );
      if (flying) {
        const band = bandsOf(config.interceptors).get(flying.interceptor);
        return (
          <span className="ops-tag" style={{ "--c": band?.colour ?? "var(--ops-phosphor)" } as CSSProperties}>
            {band?.short ?? ""} In flight
          </span>
        );
      }
      const spent = state.engagements.some((e) => e.target === track.designator);
      return spent ? <span className="ops-dim">MISS</span> : <span className="ops-dim">—</span>;
    }

    default:
      /* Declared by the designer, and nothing in the simulation produces it.
         Said as a dash with a reason rather than left blank, so it reads as
         "no value here" instead of as a value. */
      return (
        <span
          className="ops-dim"
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

/** A kill probability as a colour: good, marginal, or not worth the round. */
export function pkColour(pk: number): string {
  return pk > 0.7 ? "var(--kill)" : pk > 0 ? "var(--id-suspect)" : "var(--id-hostile)";
}

/**
 * What the transponder said, or the fact that nobody has asked.
 *
 * Three states, and the difference between the last two is the whole point:
 * not interrogated, interrogated and silent, interrogated and answering. A
 * console that showed a blank for both of the first two would be telling the
 * operator that a track refused to reply when in fact nobody asked it.
 *
 * Coloured by what the reply means. Mode 1 is the keyed military mode, so a
 * reply on it reads friendly; a Mode 3 code alone is only a code; silence is
 * unresolved; an emergency squawk is an alarm.
 */
export function Squawk({
  track,
  config,
}: {
  track: RuntimeTrack;
  config: ReturnType<typeof simConfig>;
}) {
  if (!track.squawk_known) {
    return <span className="ops-dim" title="Not interrogated">·</span>;
  }

  const mode3 = config.iff.mode_3 ? track.mode_3 : "";
  const mode1 = config.iff.mode_1 ? track.mode_1 : "";
  const reply = describeReply(mode3, mode1);

  if (!reply.replied) {
    return (
      <span style={{ color: "var(--id-unknown)" }} title="Interrogated — nothing came back">
        NO RPLY
      </span>
    );
  }

  const meaning = meaningOfMode3(mode3);
  const colour = meaning
    ? "var(--id-hostile)"
    : mode1
      ? "var(--id-friend)"
      : "var(--ops-ink)";
  return (
    <span style={{ color: colour, fontWeight: 600 }} title={meaning ?? reply.text}>
      {[mode3 && `M3 ${mode3}`, mode1 && `M1 ${mode1}`].filter(Boolean).join(" ")}
    </span>
  );
}
