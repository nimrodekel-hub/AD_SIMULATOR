/**
 * The icon set, drawn rather than imported.
 *
 * A dependency for twenty small pictures would be the wrong trade here: an
 * icon font or package arrives with its own sizing rules, its own colour
 * handling and a bundle, and the screens need none of that. These are plain
 * SVG paths on `currentColor`, so a warning icon is red because the text
 * around it is red, and an icon inside a `text-muted` heading is muted
 * without anyone saying so twice.
 *
 * Sized in `em` rather than pixels for the same reason. `text-xs` on the
 * heading shrinks the glyph with the words; nothing carries a magic number
 * that has to be kept in step with a font size somewhere else.
 *
 * All of them are `aria-hidden`. Every one sits beside a real label — an icon
 * is the second way of saying something here, never the only way, because a
 * pictogram of a radar dish means "radar" only to someone who already knew.
 */

interface IconProps {
  className?: string;
}

function Svg({
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/* ---- The sections of a profile ----------------------------------- */

/** What the radar sees: the scope, its sweep, and the site at the centre. */
export function RadarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 12 18 6" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** What can appear on the display: something airborne. */
export function TrackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5c.9 0 1.5 1.2 1.5 2.7v3l6 3.4v2l-6-1.7v3.3l2.2 1.6v1.6L12 18.8l-3.7 1.6v-1.6l2.2-1.6v-3.3l-6 1.7v-2l6-3.4v-3c0-1.5.6-2.7 1.5-2.7Z" />
    </Svg>
  );
}

/** Identification states: what a track is taken to be. */
export function IdentifyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3l7 3v5.5c0 4-2.9 7.6-7 9-4.1-1.4-7-5-7-9V6l7-3Z" />
      <path d="M9.2 11.8 11.3 14l3.6-3.8" />
    </Svg>
  );
}

/** IFF interrogation: a question sent out, and maybe an answer. */
export function TransponderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 13.5V21" />
      <path d="M8.5 21h7" />
      <circle cx="12" cy="11" r="1.6" />
      <path d="M8.8 7.8a4.5 4.5 0 0 0 0 6.4" />
      <path d="M15.2 14.2a4.5 4.5 0 0 0 0-6.4" />
      <path d="M6.2 5.2a8 8 0 0 0 0 11.6" />
      <path d="M17.8 16.8a8 8 0 0 0 0-11.6" />
    </Svg>
  );
}

/** What the operator can do: the switches that decide it. */
export function CommandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h9" />
      <path d="M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 17h3" />
      <path d="M11 17h9" />
      <circle cx="9" cy="17" r="2" />
    </Svg>
  );
}

/** What the operator reads: the columns of the track table. */
export function ColumnsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17" />
      <path d="M9.5 9.5v10" />
      <path d="M15 9.5v10" />
    </Svg>
  );
}

/** What it can reach: the engagement envelope. */
export function TargetIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 1.5v4" />
      <path d="M12 18.5v4" />
      <path d="M1.5 12h4" />
      <path d="M18.5 12h4" />
    </Svg>
  );
}

/** Who does what: the operator and the system. */
export function RolesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.4a3 3 0 0 1 0 5.2" />
      <path d="M17.5 13.6a5.5 5.5 0 0 1 3 5.9" />
    </Svg>
  );
}

/** Identity, and anything else written in prose. */
export function NotesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5h8.5L19 8v12.5H6Z" />
      <path d="M14 3.5V8h5" />
      <path d="M9 12.5h6" />
      <path d="M9 16h4" />
    </Svg>
  );
}

/* ---- The four declarable commands -------------------------------- */

/**
 * Correcting the type the console shows.
 *
 * A label with a hole in it, rather than a letter with a pencil: at the
 * 24px this renders at, two glyphs in one box read as neither.
 */
export function RetypeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12.5 4H20v7.5l-8.5 8.5L4 12.5Z" />
      <circle cx="16.4" cy="7.6" r="1.2" />
    </Svg>
  );
}

/** Refilling a launcher, on the clock. */
export function ReloadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4.5V10h-5.5" />
      <path d="M12 8.5V12l2.5 1.5" />
    </Svg>
  );
}

/** Which launcher fires — the magazine divided between rails. */
export function LauncherIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 20V10c0-3 1-5.5 2-6.5 1 1 2 3.5 2 6.5v10" />
      <path d="M7 13.5 4.5 16v4l2.5-1.5" />
      <path d="M11 13.5 13.5 16v4L11 18.5" />
      <path d="M16.5 20V9" />
      <path d="M14.5 12h4" />
    </Svg>
  );
}

/** Where a fixed array points, and what falls under the beam. */
export function TiltIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 19h16" />
      <path d="M4 19 18 8" />
      <path d="M10.5 19a8 8 0 0 0-1.7-4.9" />
      <path d="M4 19v-3" />
    </Svg>
  );
}

/* ---- State ------------------------------------------------------- */

/**
 * Something is missing or wrong, and here is where.
 *
 * The one icon in the set that carries urgency, so it is the one that must
 * never appear decoratively. It sits only beside text that says what to do.
 */
export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 21.5 20H2.5Z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Complete, and nothing left to do here. */
export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </Svg>
  );
}

/** Worth knowing, but nothing is wrong. */
export function InfoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/* ---- Actions ----------------------------------------------------- */

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  );
}

export function CrossIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </Svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 19.5V5" />
      <path d="M5.5 11.5 12 5l6.5 6.5" />
    </Svg>
  );
}

/** Flying the system to see it behave — the one action in the sequence
    that is returned to after every change. */
export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4.5 19.5 12 7 19.5Z" fill="currentColor" />
    </Svg>
  );
}
