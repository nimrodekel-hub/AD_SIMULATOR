"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  interceptorPosition,
  positionOf,
  toneOf,
  viewOf,
  type SimConfig,
  type SimState,
  type TrackView,
} from "@/lib/sim/engine";
import { polarToVec } from "@/lib/sim/geometry";
import { bandsOf, IDENTITY, type Tone } from "@/lib/ops-palette";

/**
 * The air picture, drawn as an operator would see it.
 *
 * A plan-position indicator: the site at the centre, north up, range rings out
 * to the scale in use. Everything on it is derived from the simulation each
 * frame — nothing is stored in display coordinates — so the scope cannot
 * drift out of step with the numbers in the track list beside it.
 *
 * SVG rather than canvas on purpose. The whole picture is a few hundred
 * shapes, it scales to any panel without a resize observer, and a track is a
 * real element that can be clicked, focused and read by a screen reader.
 *
 * What makes it read as an instrument rather than a diagram, and why each is
 * here:
 *
 * - **A bearing bezel.** Every five degrees, numbered every thirty. An
 *   operator calls a track by its bearing; without a scale on the edge that
 *   number came only from the table.
 * - **Round-number rings.** The spacing is chosen from 1–2–2.5–5 steps so the
 *   labels say 50 / 100 / 150 — the old quarters of the scale said 113.
 * - **The blind arc is dark.** A fixed array sees its sector and nothing else;
 *   the rest of the face is shaded out, so "it came from behind the array"
 *   is visible before it happens.
 * - **A scan beam.** Side to side for a fixed array, round for a rotating one.
 *   Driven by CSS, not by the simulation tick, so it moves smoothly at the
 *   display's own rate and costs nothing.
 * - **Plot history.** Each track trails the positions it was plotted at, which
 *   is how intent is read on a real scope — closing, crossing, turning.
 * - **Standard air symbology.** The upper half of the frame, as for any air
 *   track: an arc for friendly, a chevron for hostile, a half-square for one
 *   not yet resolved. Shape carries identity as well as colour.
 * - **Data blocks that do not collide.** Designator, flight level and speed
 *   beside each track, placed in whichever corner is free. Two tracks close
 *   together used to print their names on top of each other.
 * - **The engagement, drawn.** Each round in flight in its band's colour, with
 *   the point it will meet its target; a mark where a kill happened; the
 *   envelope of every band as its own ring.
 */

/** How far ahead of a track its velocity leader points, in seconds. */
const LEADER_SECONDS = 60;
/** Plot history: how many earlier positions, and how far apart. */
const HISTORY = 6;
const HISTORY_STEP_S = 5;
/** How long a kill or a leak stays marked on the face. */
const MARK_SECONDS = 8;

/** The face is drawn at radius 100; the bezel and the corners sit outside it. */
const R = 100;

/**
 * The range scales an operator can switch between, widest last.
 *
 * A real scope has a scale switch because the picture an operator needs is not
 * always the whole picture: four tracks at 12 km sit on top of each other at
 * 150 km, and deciding between them is exactly the moment that matters. Round
 * numbers, because a scale legend is read at a glance and 37 km is not.
 *
 * The widest is always the radar's own reach, so "all the way out" is a real
 * position on the switch rather than something adjacent to it.
 */
const LADDER = [5, 10, 20, 25, 40, 50, 75, 100, 150, 200, 300, 400, 600];

export function rangeScales(reachKm: number): number[] {
  const reach = Math.max(1, Math.round(reachKm));
  // Three steps in plus the full picture: enough to close right in, few
  // enough to press without reading the labels.
  const inside = LADDER.filter((km) => km < reach * 0.95).slice(-3);
  return [...inside, reach];
}

/** A ring spacing that gives three to five rings with round labels. */
function ringStep(reach: number): number {
  const target = reach / 4;
  return (
    [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200].find((c) => c >= target * 0.8) ??
    250
  );
}

export function RadarScope({
  state,
  config,
  selected,
  onSelect,
  rangeKm,
}: {
  state: SimState;
  config: SimConfig;
  selected: string | null;
  onSelect: (designator: string) => void;
  /**
   * The range scale in use, in kilometres — the distance the outermost ring
   * stands for. Owned above so the scale switch and the picture cannot
   * disagree about it.
   */
  rangeKm: number;
}) {
  /* SVG ids have to be unique on the page, and `url(#…)` will not take the
     colons React puts in its own. */
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<{ brg: number; rng: number } | null>(null);

  const reach = rangeKm;
  const scale = R / reach;
  const km = (value: number) => value * scale;
  const sector = config.coverage_deg < 360;
  const bands = useMemo(() => bandsOf(config.interceptors), [config.interceptors]);

  const views = useMemo(
    () =>
      state.tracks
        .map((track) => viewOf(track, state.t, config, state.tilt_deg))
        .filter((view) => view.visible)
        // Off the scale is off the scope. A track drawn beyond the outer ring
        // would be claiming a range the legend says is not on screen.
        .filter((view) => view.range_km <= reach),
    [state.tracks, state.t, state.tilt_deg, config, reach],
  );

  /* Recomputed every frame: a handful of rectangles, and caching it would
     only add a dependency list to get wrong. */
  const blocks = placeBlocks(views, km);

  const step = ringStep(reach);
  const rings: number[] = [];
  for (let r = step; r < reach - step * 0.2; r += step) rings.push(r);

  /* Where the labels run. Range figures go just inside one edge of the
     sector and envelope names just inside the other, so a band whose reach
     falls on a ring is not printed on top of that ring's number. On a radar
     that sees all round, two opposite diagonals. */
  const labelBearing = sector
    ? config.boresight_deg - config.coverage_deg / 2 + 6
    : 45;
  const envelopeBearing = sector
    ? config.boresight_deg + config.coverage_deg / 2 - 7
    : 135;

  const engaged = new Set(
    state.engagements.filter((e) => !e.resolved).map((e) => e.target),
  );

  const recent = state.events.filter(
    (event) =>
      (event.kind === "hit" || event.kind === "leaked") &&
      state.t - event.t <= MARK_SECONDS,
  );

  function readCursor(event: PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const at = point.matrixTransform(matrix.inverse());
    const x = at.x / scale;
    const y = -at.y / scale;
    const rng = Math.hypot(x, y);
    if (rng > reach) {
      setCursor(null);
      return;
    }
    const brg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
    setCursor({ brg, rng });
  }

  const hostiles = views.filter(
    (view) => toneOf(config, view.track.displayed_iff) === "hostile",
  ).length;

  return (
    <svg
      ref={svgRef}
      viewBox="-120 -120 240 240"
      className="h-full w-full select-none"
      role="img"
      aria-label={`Air picture: ${views.length} track${views.length === 1 ? "" : "s"} held`}
      onPointerMove={readCursor}
      onPointerLeave={() => setCursor(null)}
      style={{ fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace" }}
    >
      <defs>
        <radialGradient id={`${uid}-face`}>
          <stop offset="0%" stopColor="#071723" />
          <stop offset="70%" stopColor="#040d16" />
          <stop offset="100%" stopColor="var(--ops-face)" />
        </radialGradient>
        <linearGradient id={`${uid}-beam`} x1="0" y1="0" x2="0" y2="-1">
          <stop offset="0%" stopColor="var(--ops-phosphor)" stopOpacity="0.05" />
          <stop offset="100%" stopColor="var(--ops-phosphor)" stopOpacity="0.32" />
        </linearGradient>
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.9" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern
          id={`${uid}-hatch`}
          width="2.4"
          height="2.4"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line y2="2.4" stroke="var(--id-hostile)" strokeWidth="0.5" strokeOpacity="0.45" />
        </pattern>
        {/* Zoomed in, rings and envelopes are wider than the face. Clipping
            keeps them inside the scope instead of over the panel round it. */}
        <clipPath id={`${uid}-clip`}>
          <circle r={R} />
        </clipPath>
      </defs>

      {/* ---- The face --------------------------------------------- */}
      <circle r={R + 1.5} fill="var(--ops-face)" />
      <circle r={R} fill={`url(#${uid}-face)`} />

      <g clipPath={`url(#${uid}-clip)`}>
        {/* ---- What the array cannot see ------------------------- */}
        {sector ? (
          <>
            <path
              d={blindPath(config.boresight_deg, config.coverage_deg)}
              fill="#000"
              fillOpacity="0.55"
            />
            {[-1, 1].map((side) => {
              const edge = polarToVec(
                config.boresight_deg + (side * config.coverage_deg) / 2,
                reach,
              );
              return (
                <line
                  key={side}
                  x1="0"
                  y1="0"
                  x2={km(edge.x)}
                  y2={-km(edge.y)}
                  stroke="var(--ops-phosphor)"
                  strokeOpacity="0.55"
                  strokeWidth="0.4"
                />
              );
            })}
          </>
        ) : null}

        {/* ---- Grid ----------------------------------------------- */}
        {Array.from({ length: 12 }, (_, i) => i * 30).map((bearing) => {
          const end = polarToVec(bearing, reach);
          return (
            <line
              key={bearing}
              x1="0"
              y1="0"
              x2={km(end.x)}
              y2={-km(end.y)}
              stroke="var(--ops-grid)"
              strokeWidth="0.25"
            />
          );
        })}
        {rings.map((r) => (
          <circle
            key={r}
            r={km(r)}
            fill="none"
            stroke="var(--ops-grid)"
            strokeWidth="0.35"
          />
        ))}

        {/* ---- Engagement envelopes, one ring per band ------------- */}
        {config.interceptors.map((round) => {
          const band = bands.get(round.name);
          if (!band || round.max_range_km > reach * 1.02) return null;
          const at = polarToVec(envelopeBearing, round.max_range_km);
          /* A ring this small is all centre clutter; its label would sit on
             the site and the nearest tracks. The colour still says which. */
          const labelled = km(round.max_range_km) >= 14;
          return (
            <g key={round.name}>
              <circle
                r={km(round.max_range_km)}
                fill="none"
                stroke={band.colour}
                strokeOpacity="0.6"
                strokeWidth="0.45"
                strokeDasharray="2.4 1.6"
              />
              {labelled ? (
                <text
                  x={km(at.x)}
                  y={-km(at.y)}
                  fill={band.colour}
                  fontSize="3.4"
                  fontWeight="700"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  {...HALO}
                >
                  {band.short} {round.max_range_km}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* ---- The hole in the middle ------------------------------ */}
        {minReach(config) > 0 ? (
          <circle
            r={km(minReach(config))}
            fill={`url(#${uid}-hatch)`}
            stroke="var(--id-hostile)"
            strokeOpacity="0.55"
            strokeWidth="0.4"
          />
        ) : null}

        {/* ---- Range labels ---------------------------------------- */}
        {rings.map((r) => {
          const at = polarToVec(labelBearing, r);
          return (
            <text
              key={`l${r}`}
              x={km(at.x)}
              y={-km(at.y)}
              fill="var(--ops-dim)"
              fontSize="3.6"
              textAnchor="middle"
              dominantBaseline="middle"
              {...HALO}
            >
              {r}
            </text>
          );
        })}

        {/* ---- The beam -------------------------------------------- */}
        <Beam
          sector={sector}
          boresight={config.boresight_deg}
          coverage={config.coverage_deg}
          gradient={`url(#${uid}-beam)`}
        />

        {/* ---- The defended area ----------------------------------- */}
        <circle
          r={Math.max(1.6, km(config.defended_radius_km))}
          fill="var(--ops-phosphor)"
          fillOpacity="0.12"
          stroke="var(--ops-phosphor)"
          strokeOpacity="0.7"
          strokeWidth="0.4"
        />
        <path
          d="M -2.4 0 H 2.4 M 0 -2.4 V 2.4"
          stroke="var(--ops-phosphor)"
          strokeWidth="0.45"
        />

        {/* ---- Kills and leaks, briefly ---------------------------- */}
        {recent.map((event, index) => {
          if (event.kind === "leaked") {
            return (
              <circle
                key={`m${index}`}
                r="6"
                fill="none"
                stroke="var(--id-hostile)"
                strokeWidth="0.8"
                className="ops-ping"
              />
            );
          }
          const track = state.tracks.find((t) => t.designator === event.designator);
          if (!track) return null;
          const at = positionOf(track, event.t);
          const x = km(at.x);
          const y = -km(at.y);
          const fade = 1 - (state.t - event.t) / MARK_SECONDS;
          return (
            <g key={`m${index}`} opacity={Math.max(0.15, fade)}>
              <circle cx={x} cy={y} r="3" fill="none" stroke="var(--kill)" strokeWidth="0.6" className="ops-ping" />
              <path
                d={`M ${x - 2.4} ${y - 2.4} L ${x + 2.4} ${y + 2.4} M ${x + 2.4} ${y - 2.4} L ${x - 2.4} ${y + 2.4}`}
                stroke="var(--kill)"
                strokeWidth="0.8"
              />
              <text x={x + 3.5} y={y + 1.2} fill="var(--kill)" fontSize="3.2" fontWeight="700" {...HALO}>
                SPLASH
              </text>
            </g>
          );
        })}

        <g filter={`url(#${uid}-glow)`}>
          {/* ---- Plot history and leaders ------------------------- */}
          {views.map((view) => {
            const colour = IDENTITY[toneOf(config, view.track.displayed_iff) as Tone];
            const seen = view.track.first_seen_s ?? state.t;
            const ahead = {
              x: km(view.at.x + view.track.velocity.x * LEADER_SECONDS),
              y: -km(view.at.y + view.track.velocity.y * LEADER_SECONDS),
            };
            return (
              <g key={`h-${view.track.designator}`}>
                {Array.from({ length: HISTORY }, (_, i) => i + 1).map((k) => {
                  const t = state.t - k * HISTORY_STEP_S;
                  if (t < seen) return null;
                  const at = positionOf(view.track, t);
                  return (
                    <circle
                      key={k}
                      cx={km(at.x)}
                      cy={-km(at.y)}
                      r="0.55"
                      fill={colour}
                      fillOpacity={0.7 * (1 - k / (HISTORY + 1))}
                    />
                  );
                })}
                <line
                  x1={km(view.at.x)}
                  y1={-km(view.at.y)}
                  x2={ahead.x}
                  y2={ahead.y}
                  stroke={colour}
                  strokeOpacity="0.6"
                  strokeWidth="0.35"
                />
              </g>
            );
          })}

          {/* ---- Rounds in flight, and where they will meet -------- */}
          {state.engagements.map((engagement) => {
            if (engagement.resolved) return null;
            const at = interceptorPosition(engagement, state, state.t);
            const target = state.tracks.find((t) => t.designator === engagement.target);
            if (!at || !target) return null;
            const colour = bands.get(engagement.interceptor)?.colour ?? "var(--ops-phosphor)";
            const meet = positionOf(target, engagement.impact_s);
            const x = km(at.x);
            const y = -km(at.y);
            const mx = km(meet.x);
            const my = -km(meet.y);
            const angle = (Math.atan2(my - y, mx - x) * 180) / Math.PI + 90;
            return (
              <g key={engagement.id}>
                <line x1="0" y1="0" x2={x} y2={y} stroke={colour} strokeOpacity="0.35" strokeWidth="0.3" />
                <line x1={x} y1={y} x2={mx} y2={my} stroke={colour} strokeOpacity="0.7" strokeWidth="0.3" strokeDasharray="1 1" />
                <circle cx={mx} cy={my} r="1.8" fill="none" stroke={colour} strokeWidth="0.45" />
                <path d={`M ${mx - 2.8} ${my} H ${mx - 1} M ${mx + 1} ${my} H ${mx + 2.8} M ${mx} ${my - 2.8} V ${my - 1} M ${mx} ${my + 1} V ${my + 2.8}`} stroke={colour} strokeWidth="0.4" />
                <path
                  d="M 0 -2 L 1.1 1.4 L 0 0.7 L -1.1 1.4 Z"
                  transform={`translate(${x} ${y}) rotate(${angle})`}
                  fill={colour}
                />
              </g>
            );
          })}

          {/* ---- The tracks ---------------------------------------- */}
          {views.map((view) => (
            <TrackSymbol
              key={view.track.designator}
              view={view}
              tone={toneOf(config, view.track.displayed_iff) as Tone}
              km={km}
              engaged={engaged.has(view.track.designator)}
              selected={view.track.designator === selected}
              block={blocks.get(view.track.designator)}
              onSelect={onSelect}
            />
          ))}
        </g>

        {/* ---- The designated track: range and bearing from the site */}
        {(() => {
          const view = views.find((v) => v.track.designator === selected);
          if (!view) return null;
          const x = km(view.at.x);
          const y = -km(view.at.y);
          return (
            <line x1="0" y1="0" x2={x} y2={y} stroke="var(--ops-select)" strokeOpacity="0.45" strokeWidth="0.3" strokeDasharray="1.2 1.2" />
          );
        })()}
      </g>

      {/* ---- Bezel ------------------------------------------------ */}
      <circle r={R} fill="none" stroke="var(--ops-grid-strong)" strokeWidth="0.6" />
      <circle r={R + 7} fill="none" stroke="var(--ops-grid)" strokeWidth="0.3" />
      {Array.from({ length: 72 }, (_, i) => i * 5).map((bearing) => {
        const major = bearing % 30 === 0;
        const mid = bearing % 10 === 0;
        const length = major ? 5 : mid ? 3.2 : 1.8;
        const a = polarToVec(bearing, R);
        const b = polarToVec(bearing, R + length);
        return (
          <line
            key={bearing}
            x1={a.x}
            y1={-a.y}
            x2={b.x}
            y2={-b.y}
            stroke={major ? "var(--ops-grid-strong)" : "var(--ops-grid)"}
            strokeWidth={major ? 0.5 : 0.35}
          />
        );
      })}
      {Array.from({ length: 12 }, (_, i) => i * 30).map((bearing) => {
        const at = polarToVec(bearing, R + 11);
        return (
          <text
            key={`b${bearing}`}
            x={at.x}
            y={-at.y}
            fill={bearing === 0 ? "var(--ops-phosphor)" : "var(--ops-dim)"}
            fontSize="4.2"
            fontWeight={bearing === 0 ? 700 : 500}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {bearing === 0 ? "N" : pad3(bearing)}
          </text>
        );
      })}

      {/* ---- Corner readouts, outside the face -------------------- */}
      <g fontSize="3.8" fill="var(--ops-dim)">
        {/* The designated track's range and bearing from the site. Printed
            here rather than along its line: a close-in track's line is short
            and the figures landed on the symbols round the site. */}
        {(() => {
          const view = views.find((v) => v.track.designator === selected);
          return view ? (
            <text x="-118" y="108" fill="var(--ops-select)">
              SEL {view.track.designator} · {pad3(view.bearing_deg)}° ·{" "}
              {view.range_km.toFixed(1)} KM
            </text>
          ) : null;
        })()}
        <text x="118" y="-114" textAnchor="end">
          {sector ? `SECTOR ${config.coverage_deg}° · BRG ${pad3(config.boresight_deg)}°` : "360° SURVEILLANCE"}
        </text>
        <text x="118" y="-109" textAnchor="end" fill="var(--ops-phosphor)">
          SCALE {reach} KM · RINGS {step}
        </text>
        <text x="-118" y="114">
          <tspan fill="var(--ops-ink)">TRK {views.length}</tspan>
          <tspan dx="4" fill={hostiles > 0 ? "var(--id-hostile)" : "var(--ops-dim)"}>
            HOS {hostiles}
          </tspan>
          <tspan dx="4" fill={engaged.size > 0 ? "var(--band-1)" : "var(--ops-dim)"}>
            ENG {engaged.size}
          </tspan>
        </text>
        <text x="118" y="114" textAnchor="end" fill={cursor ? "var(--ops-ink)" : "var(--ops-faint)"}>
          {cursor
            ? `CUR ${pad3(cursor.brg)}° ${cursor.rng.toFixed(1)} KM`
            : "CUR ---° --.- KM"}
        </text>
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ */

/** A dark outline behind text drawn over the picture, so it reads on anything. */
const HALO = {
  stroke: "var(--ops-face)",
  strokeWidth: 1.1,
  paintOrder: "stroke",
  strokeLinejoin: "round",
} as const;

function pad3(value: number): string {
  return String(Math.round(value) % 360).padStart(3, "0");
}

/**
 * The scan beam.
 *
 * Drawn pointing north and turned by CSS, so it animates on the compositor
 * at the display's frame rate and the simulation never has to know about it.
 * A fixed array sweeps its sector back and forth; a rotating radar goes round,
 * with a fading tail behind the leading edge.
 */
function Beam({
  sector,
  boresight,
  coverage,
  gradient,
}: {
  sector: boolean;
  boresight: number;
  coverage: number;
  gradient: string;
}) {
  if (sector) {
    const style = {
      "--scan-from": `${boresight - coverage / 2 + 2}deg`,
      "--scan-to": `${boresight + coverage / 2 - 2}deg`,
    } as CSSProperties;
    return (
      <g className="ops-beam" data-mode="scan" style={style}>
        <path d={wedge(-2.5, 2.5)} fill={gradient} />
        <line x1="0" y1="0" x2="0" y2={-R} stroke="var(--ops-phosphor)" strokeOpacity="0.65" strokeWidth="0.35" />
      </g>
    );
  }
  return (
    <g className="ops-beam" data-mode="sweep">
      {Array.from({ length: 10 }, (_, i) => (
        <path
          key={i}
          d={wedge(-(i + 1) * 3, -i * 3)}
          fill="var(--ops-phosphor)"
          fillOpacity={0.16 * (1 - i / 10)}
        />
      ))}
      <line x1="0" y1="0" x2="0" y2={-R} stroke="var(--ops-phosphor)" strokeOpacity="0.8" strokeWidth="0.4" />
    </g>
  );
}

/** A thin pie slice from the centre, between two angles off north. */
function wedge(from: number, to: number): string {
  const a = polarToVec(from, R);
  const b = polarToVec(to, R);
  return `M 0 0 L ${a.x} ${-a.y} A ${R} ${R} 0 0 1 ${b.x} ${-b.y} Z`;
}

/** Everything outside the covered sector, in SVG's y-down coordinates. */
function blindPath(boresight: number, coverage: number): string {
  const blind = 360 - coverage;
  const from = polarToVec(boresight + coverage / 2, R);
  const to = polarToVec(boresight - coverage / 2, R);
  const large = blind > 180 ? 1 : 0;
  return `M 0 0 L ${from.x} ${-from.y} A ${R} ${R} 0 ${large} 1 ${to.x} ${-to.y} Z`;
}

/* ------------------------------------------------------------------ */

interface Block {
  /** Top-left of the data block, in face units. */
  x: number;
  y: number;
  /** Which side of the symbol it went, for the leader. */
  dx: -1 | 1;
  dy: -1 | 1;
}

const BLOCK_W = 22;
const BLOCK_H = 8;

/**
 * Where each track's data block goes.
 *
 * Nearest first, because the nearest tracks are the ones whose labels matter
 * most, and each takes the first corner — up-right, down-right, up-left,
 * down-left — that neither overlaps a block already placed nor sits on
 * another track's symbol. On a quiet picture every block goes up-right, as an
 * operator expects; on a crowded one they fan out instead of overprinting.
 */
function placeBlocks(views: TrackView[], km: (v: number) => number): Map<string, Block> {
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const symbols = views.map((view) => ({
    x: km(view.at.x) - 3.5,
    y: -km(view.at.y) - 3.5,
    w: 7,
    h: 7,
  }));
  const result = new Map<string, Block>();
  const corners: Array<[-1 | 1, -1 | 1]> = [
    [1, -1],
    [1, 1],
    [-1, -1],
    [-1, 1],
  ];

  for (const view of [...views].sort((a, b) => a.range_km - b.range_km)) {
    const sx = km(view.at.x);
    const sy = -km(view.at.y);
    /* The four corners close in first, then the same four pushed further
       out along a longer leader — what an operator does by hand when labels
       overprint. When nothing is clear, the spot that overlaps least. */
    let best: { block: Block; cost: number } | null = null;
    for (const reach of [4, 9, 14]) {
      for (const [dx, dy] of corners) {
        const x = dx > 0 ? sx + reach : sx - reach - BLOCK_W;
        const y = dy < 0 ? sy - reach - BLOCK_H : sy + reach;
        const box = { x, y, w: BLOCK_W, h: BLOCK_H };
        const cost =
          placed.reduce((sum, p) => sum + overlapArea(p, box), 0) +
          symbols.reduce(
            (sum, s, i) => (views[i] === view ? sum : sum + overlapArea(s, box)),
            0,
          ) +
          /* Off the edge of the scope is as bad as on top of another label. */
          (Math.hypot(x + BLOCK_W / 2, y + BLOCK_H / 2) > 108 ? BLOCK_W * BLOCK_H : 0);
        if (!best || cost < best.cost) best = { block: { x, y, dx, dy }, cost };
        if (cost === 0) break;
      }
      if (best?.cost === 0) break;
    }
    const chosen = best!.block;
    placed.push({ x: chosen.x, y: chosen.y, w: BLOCK_W, h: BLOCK_H });
    result.set(view.track.designator, chosen);
  }
  return result;
}

function overlapArea(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function TrackSymbol({
  view,
  tone,
  km,
  engaged,
  selected,
  block,
  onSelect,
}: {
  view: TrackView;
  tone: Tone;
  km: (value: number) => number;
  engaged: boolean;
  selected: boolean;
  block: Block | undefined;
  onSelect: (designator: string) => void;
}) {
  const colour = IDENTITY[tone];
  const track = view.track;
  const x = km(view.at.x);
  const y = -km(view.at.y);
  const level = String(Math.round(track.altitude_ft / 100)).padStart(3, "0");

  /* The reply, once someone has asked. Not before: a blank here and a blank
     for "nothing came back" would be the same blank. */
  const squawk = track.squawk_known
    ? track.mode_3 || track.mode_1
      ? [track.mode_3 && `M3 ${track.mode_3}`, track.mode_1 && `M1 ${track.mode_1}`]
          .filter(Boolean)
          .join(" ")
      : "NO RPLY"
    : null;

  return (
    <g
      className="cursor-pointer"
      onClick={() => onSelect(track.designator)}
      role="button"
      tabIndex={0}
      aria-label={`${track.designator}, ${track.displayed_iff}, ${view.range_km.toFixed(0)} kilometres`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(track.designator);
        }
      }}
    >
      {/* A generous invisible target: the symbol is 6 units across and a
          mouse should not have to be that accurate. */}
      <circle cx={x} cy={y} r="6" fill="transparent" />

      {engaged ? (
        <circle cx={x} cy={y} r="5.2" fill="none" stroke="var(--band-1)" strokeWidth="0.45" strokeDasharray="1.2 0.9" />
      ) : null}

      {selected ? <Designated x={x} y={y} /> : null}

      <Frame tone={tone} x={x} y={y} colour={colour} />
      <circle cx={x} cy={y} r="0.7" fill={colour} />

      {block ? (
        <g>
          <line
            x1={x + block.dx * 2.6}
            y1={y + block.dy * 2.6}
            x2={block.dx > 0 ? block.x : block.x + BLOCK_W}
            y2={block.dy < 0 ? block.y + BLOCK_H : block.y}
            stroke={colour}
            strokeOpacity="0.5"
            strokeWidth="0.25"
          />
          <text
            x={block.dx > 0 ? block.x + 0.5 : block.x + BLOCK_W - 0.5}
            y={block.y + 3.2}
            textAnchor={block.dx > 0 ? "start" : "end"}
            fontSize="3.4"
            {...HALO}
          >
            <tspan fill={colour} fontWeight="700">
              {track.designator}
            </tspan>
            <tspan
              x={block.dx > 0 ? block.x + 0.5 : block.x + BLOCK_W - 0.5}
              dy="3.6"
              fill="var(--ops-dim)"
              fontSize="2.9"
            >
              {level} {track.speed_kts}
              {squawk ? ` ${squawk}` : ""}
            </tspan>
          </text>
        </g>
      ) : null}
    </g>
  );
}

/**
 * The marker on the track the operator has designated.
 *
 * Four corner brackets, drawn tight around the symbol: close enough to read
 * as *this symbol* and not as a halo hanging in the airspace around it, and
 * clear of the velocity leader, which a closed ring would cross.
 */
function Designated({ x, y }: { x: number; y: number }) {
  const reach = 4.2;
  const arm = 1.6;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;

  return (
    <g stroke="var(--ops-select)" strokeWidth="0.55" fill="none" strokeLinecap="square">
      {corners.map(([sx, sy]) => (
        <path
          key={`${sx}${sy}`}
          d={[
            `M ${x + sx * reach} ${y + sy * reach - sy * arm}`,
            `L ${x + sx * reach} ${y + sy * reach}`,
            `L ${x + sx * reach - sx * arm} ${y + sy * reach}`,
          ].join(" ")}
        />
      ))}
    </g>
  );
}

/**
 * The air-track frame: the upper half of the standard shape, open below.
 *
 * Arc for friendly, chevron for hostile, half-square for a track not yet
 * resolved. Shape carries identity as well as colour, so the picture still
 * reads when the colours do not.
 */
function Frame({
  tone,
  x,
  y,
  colour,
}: {
  tone: Tone;
  x: number;
  y: number;
  colour: string;
}) {
  const s = 3.2;
  const stroke = { stroke: colour, strokeWidth: 0.85, strokeLinejoin: "round" as const };

  if (tone === "hostile") {
    return (
      <path
        d={`M ${x - s} ${y + 0.4} L ${x} ${y - s} L ${x + s} ${y + 0.4}`}
        fill={colour}
        fillOpacity="0.18"
        {...stroke}
      />
    );
  }
  if (tone === "friendly") {
    return (
      <path
        d={`M ${x - s} ${y + 0.4} A ${s} ${s} 0 0 1 ${x + s} ${y + 0.4}`}
        fill={colour}
        fillOpacity="0.18"
        {...stroke}
      />
    );
  }
  return (
    <path
      d={`M ${x - s * 0.85} ${y + 0.4} V ${y - s * 0.85} H ${x + s * 0.85} V ${y + 0.4}`}
      fill={colour}
      fillOpacity="0.18"
      strokeDasharray={tone === "caution" ? "1.2 0.7" : undefined}
      {...stroke}
    />
  );
}

/* ------------------------------------------------------------------ */

/** The closest any round can be used — the hole the operator must not let a threat into. */
function minReach(config: SimConfig): number {
  return Math.min(...config.interceptors.map((round) => round.min_range_km));
}
