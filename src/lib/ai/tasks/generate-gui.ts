import "server-only";
import { z } from "zod";
import type { SystemProfile } from "../../domain/schemas";
import { structured, type Anthropic } from "../client";

/**
 * Screen 1b — rebuilding the operator's console from reference screenshots.
 *
 * The brief rules out generating a GUI at runtime: this runs once, the designer
 * approves the result, and every scenario afterwards renders inside it.
 *
 * The generated markup is a *shell*, not a working interface. It supplies the
 * chrome — the header, the panel frames, the palette, the typography — and
 * marks the places where the live scenario is injected. The trainee console
 * renders real React into those slots, so the data stays interactive and only
 * the appearance comes from the model — including the radar picture, which is
 * a running simulation rather than anything the model could draw.
 *
 * The first version of this prompt asked for a console that *feels* authentic
 * rather than a copy, and that is what it produced: something plausible that
 * an operator did not recognise. Recognition is the point. An operator trains
 * their eye on where things are, and a console that puts them somewhere else,
 * however handsome, teaches the wrong reflex. So the instruction now is to
 * copy — closely, deliberately, from as many views as the designer can supply
 * — and the vendor-neutrality rule is narrowed to what it was always about:
 * the words on the screen, never the shape of it.
 */

/** Where live data is rendered. Every one of these must be present. */
export const REQUIRED_SLOTS = [
  "system-name",
  "clock",
  "scope",
  "tracks",
  "resources",
  "decision",
] as const;

const GuiDraftSchema = z.object({
  /** A self-contained HTML fragment with one inline <style> block. */
  html: z.string(),
  /** What the model took from the screenshots, for the designer to sanity-check. */
  design_notes: z.string(),
});

export type GuiDraft = z.infer<typeof GuiDraftSchema>;

const GUI_SYSTEM = `You rebuild an operator console's screen as an HTML shell, copying reference screenshots as closely as you can.

The result is the visual environment a training exercise runs inside. **An operator who works on the real system should recognise it at a glance** — same layout, same proportions, same colours, same weight of line, same density. Closeness is the entire point: an operator's competence is partly in their eyes, and a console that puts the track list where the real one puts the status strip trains them to look in the wrong place.

## Copy the appearance. Replace only what identifies.

**Reproduce, as exactly as the images let you:**

- **The grid.** How many panels, where each one sits, and roughly what fraction of the width and height it takes. If the reference is scope-left/tracks-right, yours is scope-left/tracks-right.
- **The palette**, sampled from the images rather than approximated. Background, panel fill, panel border, primary text, dimmed text, accent, and each status colour.
- **The edges and spacing.** Square or rounded corners, hairline or heavy borders, dividers or gaps, how tight the padding is.
- **The typography.** Monospace or not, how much larger the numerals are than their labels, upper or lower case, letter-spacing, weight.
- **The furniture.** Header bars, status strips, button rows, section headings and the way they are labelled.

**Do not reproduce identifying content:** vendor or product names, logos, unit markings, serial numbers, real place names, real call signs. Where the reference shows one, put the fictional system name you are given, or neutral wording, in its place. This restricts **what the text says — never how the console looks.** Geometry, colour and typography are not identifying; copy them freely.

If a screenshot shows something that should not be reproduced at all, leave that region a plain empty panel of the right size and say so in your design notes.

## Read the references before you write markup

1. **Find the image that shows the whole screen.** Take the layout from that one; the close-ups tell you about detail, not arrangement.
2. **Write the grid down** — rows, columns, and the approximate proportions.
3. **Sample the actual colours.** Use those hex values, not ones that merely look similar. Consoles are recognised by their exact green or their exact blue.
4. **Note the type and the edges** before styling anything.
5. **Then build it**, and check your layout back against the full-screen image.

**More references mean a closer copy, so use every one you are given.** Different images show different panels, different states, and colours that only appear when something is happening — an alert red, a selected row, a highlighted track. Nothing is redundant: two views of the same panel let you tell a fixed rule from a passing state.

## What to produce

A single self-contained HTML fragment:

- Exactly one \`<style>\` block at the top. All styling goes there, scoped under \`.sim-console\`.
- A root element \`<div class="sim-console">\` wrapping everything.
- **No \`<script>\` tags, no inline event handlers, no external URLs, no \`<img>\` tags.** Draw with CSS, and use inline \`<svg>\` for any rings, compass marks or icons.
- No \`<html>\`, \`<head>\` or \`<body>\` — a fragment only.

## The six slots — all are required

Place these exactly where the corresponding information sits in the reference console. Each must be an empty element carrying the attribute and nothing inside it:

- \`<div data-slot="system-name"></div>\` — the console's title area
- \`<div data-slot="clock"></div>\` — where a countdown or time readout belongs
- \`<div data-slot="scope"></div>\` — **the radar picture.** A live plan-position display is drawn into this: the site at the centre, range rings, tracks moving on it in real time. It is the single most important thing on the console and the operator looks at it constantly, so give it the largest area you can and keep it **roughly square** — a wide, short box wastes most of a circular display. If the reference shows a scope, this goes exactly where that one is, at the size it is
- \`<div data-slot="tracks"></div>\` — the track list, in the profile's readout columns
- \`<div data-slot="resources"></div>\` — where weapon or resource status is shown
- \`<div data-slot="decision"></div>\` — the engagement controls. Identification, interceptor selection, the firing solution and the fire command all sit here in one row, so make it wide and no taller than it needs to be

Leave them completely empty. Live content is injected at runtime.

## Making it usable

The slots must be **legible and large**. A faithful frame that leaves the air picture two centimetres of space is a failure: that slot should dominate, as it does on the real console.

## The console is one screen, landscape

**It must fit entirely inside the window, with no page scrolling in either direction.** An operator's position is a fixed rectangle of glass: everything is on it at once, and scrolling to find the track you are about to shoot is not a thing that happens on real equipment.

Concretely:

- The outermost element is \`height: 100%\` with \`overflow: hidden\`, and is a flex column or a grid with explicit rows.
- **Never set \`min-height\` on a panel.** Min-heights stack, and a column of them is exactly how a console becomes a page you scroll. Use \`flex: 1\` and \`min-height: 0\` so panels share out the height that exists rather than demanding their own.
- The scope takes the remaining space (\`flex: 1\`); the header, the status strip and the control row take only what they need.
- **Do not draw a scope, a track table, a clock or any readout of your own.** Every one of those is rendered live into its slot. A decorative copy beside the real one is worse than nothing: it is a second display showing a different picture, and an operator will read the wrong one.
- Anything that might overflow — a long track list, a log — gets \`overflow: auto\` on **that panel**, so it scrolls inside its own frame.

## Behave like the system, not just look like it

You are given a profile of how the system actually works, and it is binding:

- **The track slot must be laid out for the profile's readout fields.** Those are the columns the console shows, in that order. Size the panel so all of them fit without the page scrolling sideways.
- **The identification states in the profile are the only ones that exist.** If the reference shows a legend, a status key or a colour bar, populate it from those states and their tones — friendly, neutral, caution, hostile — not from what the screenshots happen to show.
- **The decision slot has to hold the operator's real actions.** Look at the workflow and the operator responsibilities: if committing an engagement takes four steps, the panel needs room for four controls, not one.
- **Do not build affordances for things the system does automatically.** A console with a "correlate tracks" button, when the profile says correlation is automatic, teaches an operator something false.

Where the screenshots and the profile disagree about *behaviour*, follow the profile: the screenshots show one moment, the profile describes the system. Where they disagree about *appearance*, follow the screenshots.

## When the designer asks for changes

You may be given the console you produced before, and the designer's change requests in order, oldest first.

- **Apply all of them.** The newest is what they just asked for; the earlier ones are still in force and must not be quietly undone.
- **Change what was asked and leave the rest exactly as it was.** A request to move one panel is not an invitation to restyle the console. The designer is converging on something; every unrequested change costs them ground.
- If a request cannot be satisfied without breaking a rule above — the slots, the single screen, vendor neutrality — do the closest thing that does not, and say so in your design notes.

## Design notes

Three or four sentences: what you took from the screenshots (name the layout and the palette you sampled), what came from the profile, what you deliberately generalised or left out, and — on a revision — what you changed this time.`;

/** One thing the designer asked to be different, and what came back. */
export interface GuiRevisionRequest {
  request: string;
}

interface GuiInput {
  /** Base64-encoded screenshots with their media types. */
  screenshots: Array<{ mediaType: string; base64: string }>;
  /** How the system behaves. The console is built to match it, not just the images. */
  profile: SystemProfile;
  systemNameFictional: string;
  /**
   * Every change the designer has asked for, oldest first.
   *
   * The whole list goes with each attempt rather than only the newest: a
   * refinement that honours the current request while quietly undoing the last
   * one is how a conversation goes in circles.
   */
  requests: string[];
  /** The previous attempt, so a revision refines rather than starts over. */
  previousHtml?: string;
}

export async function generateGuiTemplate({
  screenshots,
  profile,
  systemNameFictional,
  requests,
  previousHtml,
}: GuiInput): Promise<GuiDraft> {
  const content: Anthropic.ContentBlockParam[] = screenshots.map((shot) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: shot.mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
      data: shot.base64,
    },
  }));

  const asked = requests.filter((entry) => entry.trim().length > 0);

  content.push({
    type: "text",
    text: [
      `You have ${screenshots.length} reference image${screenshots.length === 1 ? "" : "s"} of the console to copy.`,
      `The fictional system name is "${systemNameFictional}". Use it wherever the reference shows a product or system name.`,
      `<system_profile>\n${JSON.stringify(
        {
          purpose: profile.purpose,
          track_readout_fields: profile.track_readout_fields,
          iff_states: profile.iff_states,
          track_classifications: profile.track_classifications.map((entry) => ({
            name: entry.name,
            description: entry.description,
          })),
          operator_responsibilities: profile.operator_responsibilities,
          automatic_functions: profile.automatic_functions,
          workflow_steps: profile.workflow_steps,
          engagement: profile.engagement,
          general_notes: profile.general_notes,
        },
        null,
        2,
      )}\n</system_profile>`,
      previousHtml
        ? `Here is the console you produced last time. Revise it; do not start over.\n\n<previous>\n${previousHtml}\n</previous>`
        : "",
      asked.length > 0
        ? `The designer's change requests, oldest first. All of them still apply.\n\n<requests>\n${asked
            .map((entry, index) => `${index + 1}. ${entry}`)
            .join("\n")}\n</requests>`
        : "",
      "Produce the console shell.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  const draft = await structured({
    system: GUI_SYSTEM,
    messages: [{ role: "user", content }],
    schema: GuiDraftSchema,
    effort: "high",
    maxTokens: 16000,
    label: "console",
    mock: () => ({
      html: MOCK_HTML,
      design_notes:
        "Mock console — no ANTHROPIC_API_KEY is configured, so this is a built-in placeholder rather than a reading of your screenshots.",
    }),
  });

  return { ...draft, html: sanitiseHtml(draft.html) };
}

/* ------------------------------------------------------------------ */

/**
 * Strips anything executable before the markup is ever rendered.
 *
 * The model is instructed not to emit scripts, and the designer approves the
 * result by eye — but neither is a guarantee, and this markup ends up rendered
 * into the trainee's page. Enforcing it here means the guarantee does not
 * depend on the model following instructions.
 */
export function sanitiseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\s*script[^>]*>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "");
}

/** Which of the required slots the markup is missing. */
export function missingSlots(html: string): string[] {
  return REQUIRED_SLOTS.filter(
    (slot) => !html.includes(`data-slot="${slot}"`),
  );
}

const MOCK_HTML = `<style>
.sim-console { display: flex; flex-direction: column; gap: 1px; background: #16202b; color: #cfe3f5; font-family: ui-monospace, monospace; height: 100%; overflow: hidden; }
.sim-console .bar { background: #0b1219; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
.sim-console .body { display: grid; grid-template-columns: 1.6fr 15rem 13rem; gap: 1px; flex: 1; min-height: 0; }
.sim-console .pane > [data-slot] { flex: 1; min-height: 0; }
.sim-console .pane { background: #0b1219; padding: 8px; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.sim-console .foot { background: #0b1219; padding: 10px 12px; min-height: 0; overflow: auto; }
.sim-console h4 { font-size: 10px; letter-spacing: .12em; color: #6d8399; margin-bottom: 8px; }
</style>
<div class="sim-console">
  <div class="bar">
    <div data-slot="system-name"></div>
    <div data-slot="clock"></div>
  </div>
  <div class="body">
    <div class="pane"><h4>AIR PICTURE</h4><div data-slot="scope"></div></div>
    <div class="pane"><h4>TRACKS</h4><div data-slot="tracks"></div></div>
    <div class="pane"><h4>RESOURCES</h4><div data-slot="resources"></div></div>
  </div>
  <div class="foot"><div data-slot="decision"></div></div>
</div>`;
