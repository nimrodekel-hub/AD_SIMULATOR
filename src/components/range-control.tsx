"use client";

/**
 * The scope's range scale switch.
 *
 * The consoles the model copies from reference screenshots came back with a
 * zoom stepper and a row of range-scale buttons drawn on them, because the
 * real consoles have them — but drawn as plain markup with nothing behind it.
 * Pressing them did nothing, which is the failure this whole split exists to
 * prevent: appearance comes from the model, behaviour does not. A painted
 * control is worse than a missing one, because a missing control is honest.
 *
 * So the control is real, it lives here, and it renders either into the
 * shell's `range` slot or over the corner of the scope when the shell has no
 * such slot — which is every console generated before this existed.
 *
 * `−` and `+` step through the same scales the buttons offer rather than
 * doing anything continuous. A scale switch on real equipment has positions,
 * and the legend on the scope has to keep meaning what it says.
 */
export function RangeControl({
  scales,
  value,
  onChange,
  compact = false,
}: {
  /** The selectable scales in kilometres, widest last. */
  scales: number[];
  value: number;
  onChange: (km: number) => void;
  /** Tighter type and padding, for sitting on top of the picture. */
  compact?: boolean;
}) {
  const widest = scales[scales.length - 1];
  const index = scales.indexOf(value);
  // A scale that is not on the switch still has to step somewhere sensible.
  const nearest =
    index >= 0
      ? index
      : scales.reduce(
          (best, km, at) =>
            Math.abs(km - value) < Math.abs(scales[best] - value) ? at : best,
          0,
        );

  const step = (by: number) => {
    const next = Math.min(scales.length - 1, Math.max(0, nearest + by));
    onChange(scales[next]);
  };

  const size = compact ? "text-[0.6rem]" : "text-[0.7rem]";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div className="flex items-center gap-1">
        <span className={`${size} uppercase tracking-[0.1em] text-muted`}>
          Range
        </span>
        {/* In, then out: on a scope, "−" is less range on the ring — which is
            closer in and therefore more magnification. Labelled so the two
            readings of the same button cannot be confused. */}
        <button
          type="button"
          className={`btn ${size} px-1.5 py-0.5`}
          onClick={() => step(-1)}
          disabled={nearest === 0}
          aria-label="Zoom in — shorter range scale"
          title="Zoom in — shorter range scale"
        >
          −
        </button>
        <button
          type="button"
          className={`btn ${size} px-1.5 py-0.5`}
          onClick={() => step(1)}
          disabled={nearest === scales.length - 1}
          aria-label="Zoom out — longer range scale"
          title="Zoom out — longer range scale"
        >
          +
        </button>
        <button
          type="button"
          className={`btn ${size} px-1.5 py-0.5`}
          onClick={() => onChange(widest)}
          disabled={value === widest}
          aria-label="Fit the whole picture"
          title="Fit — out to everything the radar reaches"
        >
          FIT
        </button>
      </div>

      <div className="flex items-center gap-1">
        {scales.map((km) => (
          <button
            key={km}
            type="button"
            className={`btn data ${size} px-1.5 py-0.5 ${km === value ? "btn-primary" : ""}`}
            onClick={() => onChange(km)}
            aria-pressed={km === value}
            aria-label={`${km} kilometre range scale`}
          >
            {km}
          </button>
        ))}
        <span className={`${size} text-muted`}>km</span>
      </div>
    </div>
  );
}
