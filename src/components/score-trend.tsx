/**
 * Score history, as a sparkline in the roster and as a full plot on the
 * drill-down.
 *
 * One series, so there is no legend: the surrounding label already says what is
 * plotted. Only the latest point is marked and labelled — a value on every
 * point is noise, and the session table below the chart is the authoritative
 * view of every number.
 *
 * Colours come from the screen's theme tokens, so the same component reads
 * correctly on both the operations and the working surfaces.
 */

/** Scores are 0-100, so the scale is fixed rather than fitted to the data. */
const MIN = 0;
const MAX = 100;

function points(scores: number[], width: number, height: number, pad: number) {
  const span = Math.max(scores.length - 1, 1);
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;

  return scores.map((score, index) => ({
    x: pad + (index / span) * usableW,
    // A single run has nothing to trend against, so centre it rather than
    // pinning it to an edge and implying a direction.
    y:
      pad +
      usableH -
      ((Math.min(Math.max(score, MIN), MAX) - MIN) / (MAX - MIN)) * usableH,
    score,
  }));
}

/* ------------------------------------------------------------------ */
/* Sparkline — the trend channel of a stat tile                        */
/* ------------------------------------------------------------------ */

export function ScoreSparkline({
  scores,
  width = 96,
  height = 28,
}: {
  scores: number[];
  width?: number;
  height?: number;
}) {
  // One point is not a trend. Say so rather than drawing a misleading flat line.
  if (scores.length < 2) {
    return <span className="text-xs text-muted">—</span>;
  }

  const plotted = points(scores, width, height, 5);
  const path = plotted.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = plotted[plotted.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Score trend across ${scores.length} runs, most recent ${Math.round(last.score)}`}
      className="overflow-visible"
    >
      <polyline
        points={path}
        fill="none"
        stroke="var(--muted)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 2px ring in the surface colour keeps the marker legible where it sits
          on the line. */}
      <circle
        cx={last.x}
        cy={last.y}
        r={4}
        fill="var(--accent)"
        stroke="var(--panel)"
        strokeWidth={2}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Full plot — the drill-down                                          */
/* ------------------------------------------------------------------ */

export function ScoreHistoryChart({
  scores,
  labels,
  height = 180,
}: {
  scores: number[];
  /** One per score, used in the point's tooltip. */
  labels: string[];
  height?: number;
}) {
  if (scores.length === 0) return null;

  const width = 720;
  const pad = 18;
  const plotted = points(scores, width, height, pad);
  const last = plotted[plotted.length - 1];

  /* Ticks at clean numbers. They carry the values that are not directly
     labelled, which is everything except the latest run. */
  const ticks = [0, 50, 100];

  /* The last point sits at the right edge, so its label goes to the left of the
     marker rather than through it. */
  const labelAtEnd = last.x > width - 60;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label={`Score across ${scores.length} completed runs`}
    >
      {ticks.map((tick) => {
        const y =
          pad + (height - pad * 2) - ((tick - MIN) / (MAX - MIN)) * (height - pad * 2);
        return (
          <g key={tick}>
            {/* Hairline, solid, recessive — never dashed. */}
            <line
              x1={pad}
              x2={width - pad}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={0}
              y={y + 3}
              className="data"
              fontSize={9}
              fill="var(--muted)"
            >
              {tick}
            </text>
          </g>
        );
      })}

      {plotted.length > 1 ? (
        <polyline
          points={plotted.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}

      {plotted.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r={index === plotted.length - 1 ? 5 : 4}
          fill={index === plotted.length - 1 ? "var(--accent)" : "var(--muted)"}
          stroke="var(--panel)"
          strokeWidth={2}
        >
          <title>{`${labels[index] ?? `Run ${index + 1}`} — ${Math.round(point.score)}`}</title>
        </circle>
      ))}

      {/* The one direct label: the latest run. Text wears a text token, never
          the series colour — the coloured dot beside it carries identity. */}
      <text
        x={labelAtEnd ? last.x - 10 : last.x + 10}
        y={last.y + 3}
        className="data"
        fontSize={11}
        fill="var(--text)"
        textAnchor={labelAtEnd ? "end" : "start"}
      >
        {Math.round(last.score)}
      </text>
    </svg>
  );
}
