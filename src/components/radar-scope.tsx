"use client";

import { useMemo } from "react";
import {
  interceptorPosition,
  toneOf,
  viewOf,
  type SimConfig,
  type SimState,
  type TrackView,
} from "@/lib/sim/engine";
import { polarToVec } from "@/lib/sim/geometry";

/**
 * The air picture, drawn as an operator would see it.
 *
 * A plan-position indicator: the site at the centre, north up, range rings out
 * to whatever the radar reaches. Everything on it is derived from the
 * simulation each frame — nothing is stored in display coordinates — so the
 * scope cannot drift out of step with the numbers in the track list beside it.
 *
 * SVG rather than canvas on purpose. The whole picture is a few dozen shapes,
 * it scales to any panel size without a resize observer or a device-pixel
 * dance, and a track is a real element that can be clicked, focused and given
 * a label a screen reader can read.
 *
 * Symbols follow the usual convention closely enough to be learnable: a
 * half-circle for something friendly, a diamond for something hostile, a
 * square for what has not been resolved. Shape carries the identity as well as
 * colour, so the picture still reads when the colours do not.
 */

/** Range rings, as fractions of the radar's reach. */
const RINGS = [0.25, 0.5, 0.75, 1];
/** How far ahead of a track its velocity leader points, in seconds. */
const LEADER_SECONDS = 60;

const TONE_COLOUR = {
  friendly: "var(--ok)",
  neutral: "var(--warn)",
  caution: "var(--warn)",
  hostile: "var(--danger)",
} as const;

export function RadarScope({
  state,
  config,
  selected,
  onSelect,
}: {
  state: SimState;
  config: SimConfig;
  selected: string | null;
  onSelect: (designator: string) => void;
}) {
  /* The drawing is done in kilometres and mapped to the viewBox once, so every
     number below is a real distance and the scale lives in exactly one place. */
  const reach = config.detection_range_km;
  const scale = 100 / reach;
  const km = (value: number) => value * scale;

  const views = useMemo(
    () =>
      state.tracks
        .map((track) => viewOf(track, state.t, config))
        .filter((view) => view.visible),
    [state.tracks, state.t, config],
  );

  const sweep = (state.t * 60) % 360;

  return (
    <svg
      viewBox="-110 -110 220 220"
      className="h-full w-full"
      role="img"
      aria-label={`Air picture: ${views.length} track${views.length === 1 ? "" : "s"} held`}
    >
      <defs>
        <radialGradient id="scope-glow">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.10" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle r="100" fill="url(#scope-glow)" />

      {/* ---- The arc the radar actually covers ---------------------- */}
      {config.coverage_deg < 360 ? (
        <path
          d={sectorPath(config.boresight_deg, config.coverage_deg, 100)}
          fill="var(--accent)"
          fillOpacity="0.05"
          stroke="var(--accent)"
          strokeOpacity="0.35"
          strokeWidth="0.4"
          strokeDasharray="2 2"
        />
      ) : null}

      {/* ---- Range rings -------------------------------------------- */}
      {RINGS.map((fraction) => (
        <circle
          key={fraction}
          r={100 * fraction}
          fill="none"
          stroke="var(--border)"
          strokeWidth="0.35"
        />
      ))}
      {RINGS.map((fraction) => (
        <text
          key={`label-${fraction}`}
          x="1.5"
          y={-100 * fraction - 1.5}
          fill="var(--muted)"
          fontSize="4"
          fontFamily="ui-monospace, monospace"
        >
          {Math.round(reach * fraction)}
        </text>
      ))}

      {/* ---- The engagement envelope, and the hole in the middle ----- */}
      <circle
        r={km(maxReach(config))}
        fill="none"
        stroke="var(--ok)"
        strokeOpacity="0.45"
        strokeWidth="0.5"
        strokeDasharray="3 2"
      />
      {minReach(config) > 0 ? (
        <circle
          r={km(minReach(config))}
          fill="var(--danger)"
          fillOpacity="0.07"
          stroke="var(--danger)"
          strokeOpacity="0.4"
          strokeWidth="0.4"
        />
      ) : null}

      {/* ---- Cardinal spokes ---------------------------------------- */}
      {[0, 90, 180, 270].map((bearing) => {
        const end = polarToVec(bearing, reach);
        return (
          <line
            key={bearing}
            x1="0"
            y1="0"
            x2={km(end.x)}
            y2={-km(end.y)}
            stroke="var(--border)"
            strokeWidth="0.25"
          />
        );
      })}
      {(
        [
          ["N", 0],
          ["E", 90],
          ["S", 180],
          ["W", 270],
        ] as const
      ).map(([letter, bearing]) => {
        const at = polarToVec(bearing, reach * 1.06);
        return (
          <text
            key={letter}
            x={km(at.x)}
            y={-km(at.y)}
            fill="var(--muted)"
            fontSize="5"
            textAnchor="middle"
            dominantBaseline="middle"
            fontFamily="ui-monospace, monospace"
          >
            {letter}
          </text>
        );
      })}

      {/* ---- The sweep, for a radar that turns ----------------------- */}
      {config.coverage_deg >= 360 ? (
        <line
          x1="0"
          y1="0"
          x2={km(polarToVec(sweep, reach).x)}
          y2={-km(polarToVec(sweep, reach).y)}
          stroke="var(--accent)"
          strokeOpacity="0.5"
          strokeWidth="0.6"
        />
      ) : null}

      {/* ---- The defended area -------------------------------------- */}
      <circle
        r={Math.max(1.5, km(config.defended_radius_km))}
        fill="var(--accent)"
        fillOpacity="0.5"
      />

      {/* ---- Interceptors in flight --------------------------------- */}
      {state.engagements.map((engagement) => {
        const at = interceptorPosition(engagement, state, state.t);
        if (!at) return null;
        return (
          <g key={engagement.id}>
            <line
              x1="0"
              y1="0"
              x2={km(at.x)}
              y2={-km(at.y)}
              stroke="var(--ok)"
              strokeOpacity="0.3"
              strokeWidth="0.3"
            />
            <circle
              cx={km(at.x)}
              cy={-km(at.y)}
              r="1.2"
              fill="var(--ok)"
              stroke="var(--bg)"
              strokeWidth="0.3"
            />
          </g>
        );
      })}

      {/* ---- The tracks --------------------------------------------- */}
      {views.map((view) => (
        <TrackSymbol
          key={view.track.designator}
          view={view}
          config={config}
          km={km}
          selected={view.track.designator === selected}
          onSelect={onSelect}
        />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */

function TrackSymbol({
  view,
  config,
  km,
  selected,
  onSelect,
}: {
  view: TrackView;
  config: SimConfig;
  km: (value: number) => number;
  selected: boolean;
  onSelect: (designator: string) => void;
}) {
  const tone = toneOf(config, view.track.displayed_iff);
  const colour = TONE_COLOUR[tone];
  const x = km(view.at.x);
  const y = -km(view.at.y);

  // Where it will be in a minute: the leader is how an operator reads intent
  // at a glance, and it is the difference between "closing" and "crossing".
  const ahead = {
    x: km(view.at.x + view.track.velocity.x * LEADER_SECONDS),
    y: -km(view.at.y + view.track.velocity.y * LEADER_SECONDS),
  };

  return (
    <g
      className="cursor-pointer"
      onClick={() => onSelect(view.track.designator)}
      role="button"
      tabIndex={0}
      aria-label={`${view.track.designator}, ${view.track.displayed_iff}, ${view.range_km.toFixed(0)} kilometres`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(view.track.designator);
        }
      }}
    >
      {/* A generous invisible target: the symbol is 3 units across and a
          mouse should not have to be that accurate. */}
      <circle cx={x} cy={y} r="6" fill="transparent" />

      <line
        x1={x}
        y1={y}
        x2={ahead.x}
        y2={ahead.y}
        stroke={colour}
        strokeOpacity="0.7"
        strokeWidth="0.4"
      />

      {selected ? (
        <circle
          cx={x}
          cy={y}
          r="5"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="0.6"
        />
      ) : null}

      <Symbol tone={tone} x={x} y={y} colour={colour} />

      <text
        x={x + 4}
        y={y - 3}
        fill={colour}
        fontSize="4"
        fontFamily="ui-monospace, monospace"
      >
        {view.track.designator}
      </text>
    </g>
  );
}

/** Shape carries identity too, so the picture reads without colour. */
function Symbol({
  tone,
  x,
  y,
  colour,
}: {
  tone: keyof typeof TONE_COLOUR;
  x: number;
  y: number;
  colour: string;
}) {
  const common = {
    fill: "none",
    stroke: colour,
    strokeWidth: 0.9,
  };

  if (tone === "hostile") {
    return (
      <path d={`M ${x} ${y - 3} L ${x + 3} ${y} L ${x} ${y + 3} L ${x - 3} ${y} Z`} {...common} />
    );
  }
  if (tone === "friendly") {
    return <path d={`M ${x - 3} ${y + 1} A 3 3 0 0 1 ${x + 3} ${y + 1}`} {...common} />;
  }
  return <rect x={x - 2.6} y={y - 2.6} width="5.2" height="5.2" {...common} />;
}

/* ------------------------------------------------------------------ */

/** The furthest any available round can reach. */
function maxReach(config: SimConfig): number {
  return Math.max(...config.interceptors.map((round) => round.max_range_km));
}

/** The closest any round can be used — the hole the operator must not let a threat into. */
function minReach(config: SimConfig): number {
  return Math.min(...config.interceptors.map((round) => round.min_range_km));
}

/** A pie slice centred on the boresight, in SVG's y-down coordinates. */
function sectorPath(boresight: number, coverage: number, radius: number): string {
  const from = polarToVec(boresight - coverage / 2, radius);
  const to = polarToVec(boresight + coverage / 2, radius);
  const large = coverage > 180 ? 1 : 0;
  return [
    "M 0 0",
    `L ${from.x} ${-from.y}`,
    `A ${radius} ${radius} 0 ${large} 1 ${to.x} ${-to.y}`,
    "Z",
  ].join(" ");
}
