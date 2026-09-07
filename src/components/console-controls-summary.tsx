import Link from "next/link";
import type { SystemProfile } from "@/lib/domain/schemas";

/**
 * Which controls this console is allowed to have, before anyone asks for one.
 *
 * The console builder dresses the operator's controls; it does not create
 * them. Every one is a React component the simulator renders only where the
 * behaviour profile declares the command, so a designer asking for "a reload
 * button in green" is asking for two different things from two different
 * places — and used to be told so in a paragraph of prose, at the end of a
 * long answer, naming a field with no route to it.
 *
 * The answer is the same either way, so it may as well be on screen before the
 * request: here is what the console can show, here is what it cannot, and here
 * is the one link that changes it. A refusal a designer can act on in a click
 * is a different thing from a refusal they have to decode.
 *
 * The conditions below are the engine's own, copied deliberately rather than
 * imported: `toConfig` builds a runtime object and this needs the reason a
 * control is missing, not the fact. Where they could drift, the tests that
 * matter are in the engine — but a command declared without the figure it runs
 * on is off in both places, and saying *that* is most of this panel's value.
 */

interface Control {
  name: string;
  /** Whether the simulator will actually render it. */
  on: boolean;
  /** What it does, for a designer who is choosing whether to switch it on. */
  does: string;
  /** Why it is off, where "off" is not the whole story. */
  because?: string;
}

function controlsOf(profile: SystemProfile | null): Control[] {
  const commands = profile?.operator_commands;
  const reloadSeconds = commands?.reload_seconds ?? 0;
  const launcherCount = commands?.launchers === true
    ? Math.max(1, Math.round(commands.launcher_count ?? 1))
    : 1;
  const tiltMin = commands?.tilt_min_deg ?? null;
  const tiltMax = commands?.tilt_max_deg ?? null;

  return [
    {
      name: "Fire and cease fire",
      on: true,
      does: "Commit a round to the selected track, and break a committed engagement.",
    },
    {
      name: "Interrogate",
      on: profile?.iff_interrogation?.enabled === true,
      does: "Ask a track's transponder to identify itself.",
    },
    {
      name: "Reload",
      on: commands?.reload === true && reloadSeconds > 0,
      does: "Refill a magazine during a run, while the clock keeps going.",
      because:
        commands?.reload === true && reloadSeconds <= 0
          ? "Switched on, but with no reload time — a reload that takes no time is not a decision, so the simulator treats it as off. Give it the seconds it really takes."
          : undefined,
    },
    {
      name: "Choose a launcher",
      on: launcherCount > 1,
      does: "Send the round from a particular launcher rather than the next available one.",
      because:
        commands?.launchers === true && launcherCount <= 1
          ? "Switched on, but the system has one launcher — there is nothing to choose between. Set how many launchers it really has."
          : undefined,
    },
    {
      name: "Retype a track",
      on: commands?.retype === true,
      does: "Correct the class the system assigned to a track.",
    },
    {
      name: "Tilt the radar",
      on:
        commands?.tilt === true &&
        tiltMin !== null &&
        tiltMax !== null &&
        tiltMin < tiltMax,
      does: "Move a fixed array's elevation during a run.",
      because:
        commands?.tilt === true && (tiltMin === null || tiltMax === null)
          ? "Switched on, but with no elevation limits — the simulator cannot draw a control with no range. Give it the degrees it moves between."
          : undefined,
    },
  ];
}

export function ConsoleControlsSummary({
  systemId,
  profile,
}: {
  systemId: string;
  profile: SystemProfile | null;
}) {
  const controls = controlsOf(profile);
  const off = controls.filter((control) => !control.on);

  return (
    <div className="panel mb-8 p-5">
      <h2 className="text-sm font-semibold">
        What this console is allowed to show
      </h2>
      <p className="prose-block mt-1 max-w-2xl text-xs text-muted">
        The builder decides how the console <em>looks</em> — the palette, the
        panels, where everything sits. It cannot add a control that this system
        does not have: each one is switched on in the behaviour profile, and the
        simulator draws it only where it is on. Asking the builder to colour a
        button that is switched off will always come back as a refusal, however
        it is worded.
      </p>

      <ul className="mt-4 space-y-2">
        {controls.map((control) => (
          <li
            key={control.name}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
          >
            <span
              aria-hidden
              className={`text-sm font-semibold ${control.on ? "text-ok" : "text-muted"}`}
            >
              {control.on ? "✓" : "—"}
            </span>
            <span
              className={`text-sm ${control.on ? "" : "text-muted line-through decoration-1"}`}
            >
              {control.name}
            </span>
            <span className="min-w-0 flex-1 text-xs text-muted">
              {control.because ?? control.does}
            </span>
          </li>
        ))}
      </ul>

      {off.length > 0 ? (
        <p className="mt-4 text-xs text-muted">
          {off.length === controls.length - 1
            ? "Everything except firing is switched off, so the console has almost nothing for the builder to dress."
            : `${off.length} of these are switched off.`}{" "}
          <Link
            href={`/designer/systems/${systemId}/profile`}
            className="text-accent"
          >
            Turn them on in the behaviour profile
          </Link>{" "}
          and rebuild the console — the builder will dress whatever appears.
        </p>
      ) : null}
    </div>
  );
}
