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
 * So the control is real, it lives here, and it renders in one of three
 * places — which is what `variant` is about, because the three differ in who
 * owns the chrome around it:
 *
 *   - **bar** — the built-in console's own header, which is ours. Full size,
 *     labelled, free to wrap.
 *   - **slot** — the designer's shell, into its `data-slot="range"`. The shell
 *     owns everything around it exactly as it does for the track list and the
 *     resource panel: it draws the *Range* caption itself and reserves a
 *     strip of a fixed height for the buttons. So this draws no caption of
 *     its own —
 *     two consoles' worth of the same word, one drawn over the other, is what
 *     the shell's own bar looked like before — and it never wraps, because a
 *     second row inside a strip with `overflow:hidden` is a row of buttons the
 *     operator cannot reach and cannot see.
 *   - **overlay** — over the corner of the picture, for a shell with no such
 *     slot. There is no chrome, so it carries its own caption.
 *
 * `−` and `+` step through the same scales the buttons offer rather than
 * doing anything continuous. A scale switch on real equipment has positions,
 * and the legend on the scope has to keep meaning what it says.
 */
export function RangeControl({
  scales,
  value,
  onChange,
  variant = "bar",
}: {
  /** The selectable scales in kilometres, widest last. */
  scales: number[];
  value: number;
  onChange: (km: number) => void;
  /** Where it is being drawn, and therefore who owns the chrome round it. */
  variant?: "bar" | "slot" | "overlay";
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

  const inShell = variant === "slot";
  const size = variant === "bar" ? "text-[0.7rem]" : "text-[0.6rem]";

  /* `.btn` is unlayered in `globals.css`, so it outranks `@layer utilities`
     and every size utility here is dropped without `!`. That is not a detail:
     left plain these render at the full 0.875rem with 0.5rem×1rem of padding —
     about 35 px against the 20 px strip a shell reserves for them — and the
     buttons then sit on top of the shell's own caption row. In a strip that
     tight the padding goes entirely and the line box carries the height.

     Every one of these is written out whole, never assembled from a variable.
     Tailwind generates a utility by finding its name as a literal in the
     source: build `!` + `text-[0.6rem]` at runtime and the two halves are both
     present, the joined name is not, and the rule is silently never emitted —
     which is the same failure as leaving the `!` off, one level further back
     and invisible in the browser's own styles panel. */
  const forced = variant === "bar" ? "!text-[0.7rem]" : "!text-[0.6rem]";
  const pill = `btn ${forced} !px-1.5 ${inShell ? "!py-0 !leading-4" : "!py-0.5"}`;

  return (
    <div
      className={`flex items-center gap-x-2 ${
        inShell ? "h-full min-w-0 flex-nowrap overflow-hidden" : "flex-wrap gap-y-1"
      }`}
    >
      <div className="flex items-center gap-1">
        {inShell ? null : (
          <span className={`${size} uppercase tracking-[0.1em] text-muted`}>
            Range
          </span>
        )}
        {/* In, then out: on a scope, "−" is less range on the ring — which is
            closer in and therefore more magnification. Labelled so the two
            readings of the same button cannot be confused. */}
        <button
          type="button"
          className={pill}
          onClick={() => step(-1)}
          disabled={nearest === 0}
          aria-label="Zoom in — shorter range scale"
          title="Zoom in — shorter range scale"
        >
          −
        </button>
        <button
          type="button"
          className={pill}
          onClick={() => step(1)}
          disabled={nearest === scales.length - 1}
          aria-label="Zoom out — longer range scale"
          title="Zoom out — longer range scale"
        >
          +
        </button>
        <button
          type="button"
          className={pill}
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
            className={`${pill} data ${km === value ? "btn-primary" : ""}`}
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
