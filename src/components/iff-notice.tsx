"use client";

import { AlertIcon, InfoIcon, TransponderIcon } from "@/components/icons";

/**
 * Why there is no IFF in the track table, said where the designer is looking.
 *
 * The complaint that produced this was "IFF does not appear in the track
 * readout", and the profile behind it was doing exactly what it had been told:
 * no interrogator declared, no IFF column named, no track class carrying a
 * transponder. Three separate switches, each in a different part of the form,
 * each individually reasonable, and nothing anywhere saying that the three of
 * them together are what puts a code in front of a trainee.
 *
 * So this says it, in the section where the columns are chosen, and offers the
 * fix as a button rather than as instructions. It is not a gap notice: a
 * system with no interrogator is a legitimate system, and training an operator
 * to identify by behaviour alone is a deliberate choice rather than an
 * omission. What is never legitimate is not knowing which one you have.
 */
export function IffReadoutNotice({
  hasColumn,
  interrogatorOn,
  replyingClasses,
  onAddColumn,
  onEnableInterrogator,
  onFixBoth,
}: {
  /** Whether a column labelled IFF is declared. */
  hasColumn: boolean;
  /** Whether the system declares an interrogator at all. */
  interrogatorOn: boolean;
  /** How many track classes reply to one. Silence on every track is a gap. */
  replyingClasses: number;
  onAddColumn: () => void;
  onEnableInterrogator: () => void;
  /**
   * Both at once, as one edit.
   *
   * Its own handler rather than the two called in turn, because both write the
   * whole draft: calling them one after the other from the same render leaves
   * the second overwriting the first, and the designer clicks a button that
   * does half of what it says.
   */
  onFixBoth: () => void;
}) {
  /* Everything in place, and something actually answers. Nothing to say. */
  if (hasColumn && interrogatorOn && replyingClasses > 0) return null;

  if (hasColumn && interrogatorOn) {
    return (
      <Notice tone="warn">
        <strong>The IFF column will be empty on every track.</strong> The
        interrogator is declared and the column is here, but no track class
        below carries a transponder — so every interrogation returns silence.
        That is a real system if it is yours; if it is not, say which classes
        reply, under each class&apos;s <em>Transponder</em>.
      </Notice>
    );
  }

  if (hasColumn) {
    return (
      <Notice tone="warn">
        <strong>
          The IFF column is here, but nothing can ever fill it in.
        </strong>{" "}
        This system declares no interrogator, so the operator has no way to ask
        a track for a code and the column stays blank for the whole run.
        <Fix label="Turn the interrogator on" onClick={onEnableInterrogator} />
      </Notice>
    );
  }

  if (interrogatorOn) {
    return (
      <Notice tone="warn">
        <strong>No IFF column is declared.</strong> The interrogator works and
        the reply goes into the run log, but the track table is built from the
        columns named here, so it has nowhere to show it — and the trainee
        reads the table.
        <Fix label="Add an IFF column" onClick={onAddColumn} />
      </Notice>
    );
  }

  return (
    <Notice tone="info">
      <strong>No IFF reaches the trainee at all.</strong> This system declares
      no interrogator and no IFF column, so nothing on the console ever shows a
      transponder code and the operator identifies by behaviour alone. That is
      a deliberate system to train on — but if yours can interrogate, this is
      the switch that has been missed.
      <Fix
        label="Turn the interrogator on and add the column"
        onClick={onFixBoth}
      />
    </Notice>
  );
}

/** The column an IFF reply lands in, worded once so both forms add the same. */
export const IFF_COLUMN = {
  label: "IFF",
  unit: "",
  description:
    "Transponder reply — the Mode 3 code, or that nothing came back. Blank until interrogated.",
};

function Notice({
  tone,
  children,
}: {
  tone: "warn" | "info";
  children: React.ReactNode;
}) {
  const Icon = tone === "warn" ? AlertIcon : InfoIcon;
  return (
    <div
      className={`panel p-3 ${
        tone === "warn"
          ? "!border-l-2 !border-l-warn"
          : "!border-l-2 !border-l-line"
      }`}
    >
      <p className="flex items-start gap-2 text-xs leading-relaxed">
        <Icon
          className={`mt-[0.15rem] shrink-0 text-sm ${
            tone === "warn" ? "text-warn" : "text-muted"
          }`}
        />
        <span>{children}</span>
      </p>
    </div>
  );
}

function Fix({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn mt-2 flex text-xs" onClick={onClick}>
      <TransponderIcon className="text-sm" />
      {label}
    </button>
  );
}
