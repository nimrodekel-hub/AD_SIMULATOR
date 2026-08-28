import "server-only";
import { z } from "zod";
import type { SystemProfile } from "../../domain/schemas";
import { structured, type Anthropic } from "../client";

/**
 * Screen 1b — building the simulated console from reference screenshots.
 *
 * The brief rules out generating a GUI at runtime: this runs once, the designer
 * approves the result, and every scenario afterwards renders inside it.
 *
 * The generated markup is a *shell*, not a working interface. It supplies the
 * chrome — the header, the panel frames, the palette, the typography — and
 * marks five places where the live scenario is injected. The trainee console
 * renders real React into those slots, so the data stays interactive and only
 * the appearance comes from the model.
 */

/** The five places live data is rendered into. All five must be present. */
export const REQUIRED_SLOTS = [
  "system-name",
  "clock",
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

const GUI_SYSTEM = `You reproduce the look and feel of an operator console as a static HTML shell, from reference screenshots.

The result is the visual environment a training scenario renders inside. It is a training tool, so the goal is a console that *feels* authentic to an operator — not a replica of any particular product.

## Vendor neutrality — a hard rule

Reproduce **layout, palette, density, typography and panel structure**. Do not reproduce any identifying content you can see in the screenshots: no vendor names, product names, logos, unit markings, serial numbers, real place names, or real call signs. Where the screenshots show such a thing, replace it with the fictional system name you are given, or with neutral wording.

If a screenshot appears to show material that should not be reproduced at all, leave that region as a generic empty panel and say so in your design notes.

## What to produce

A single self-contained HTML fragment:

- Exactly one \`<style>\` block at the top. All styling goes there, scoped under \`.sim-console\`.
- A root element \`<div class="sim-console">\` wrapping everything.
- **No \`<script>\` tags, no inline event handlers, no external URLs, no \`<img>\` tags.** Draw with CSS, and use inline \`<svg>\` for any radar rings, compass marks or icons.
- No \`<html>\`, \`<head>\` or \`<body>\` — a fragment only.

## The five slots — all are required

Place these exactly where the corresponding information sits in the reference console. Each must be an empty element carrying the attribute and nothing inside it:

- \`<div data-slot="system-name"></div>\` — the console's title area
- \`<div data-slot="clock"></div>\` — where a countdown or time readout belongs
- \`<div data-slot="tracks"></div>\` — the main air picture area, the largest panel
- \`<div data-slot="resources"></div>\` — where weapon or resource status is shown
- \`<div data-slot="decision"></div>\` — where prompts and controls sit, usually along the bottom

Leave them completely empty. Live content is injected at runtime, so give each one room to grow — set a sensible min-height and let the surrounding layout flex rather than fixing pixel heights.

## Making it usable

The slots must be **legible and large**. A beautiful frame that leaves the track table two centimetres of space is a failure: the air picture slot should dominate, as it does on a real console.

Build the layout with CSS grid or flexbox so it survives different window sizes. The console must not require horizontal scrolling of the page.

Prefer dark palettes and monospace numerals unless the screenshots clearly show otherwise.

## Behave like the system, not just look like it

You are given a profile of how the system actually works, and it is binding:

- **The air-picture slot must be laid out for the profile's readout fields.** Those are the columns the console shows, in that order. Size the panel so all of them fit without the page scrolling sideways.
- **The identification states in the profile are the only ones that exist.** If the reference console shows a legend, a status key or a colour bar, populate it from those states and their tones — friendly, neutral, caution, hostile — not from what the screenshots happen to show.
- **The decision slot has to hold the operator's real actions.** Look at the workflow and the operator responsibilities: if committing an engagement takes four steps, the panel needs room for four controls, not one.
- **Do not build affordances for things the system does automatically.** A console with a "correlate tracks" button, when the profile says correlation is automatic, teaches an operator something false.

Where the screenshots and the profile disagree, follow the profile: the screenshots show one moment, the profile describes the system.

## Design notes

Two or three sentences: what you took from the screenshots, what you took from the profile, and anything you deliberately left out or generalised.`;

interface GuiInput {
  /** Base64-encoded screenshots with their media types. */
  screenshots: Array<{ mediaType: string; base64: string }>;
  /** How the system behaves. The console is built to match it, not just the images. */
  profile: SystemProfile;
  systemNameFictional: string;
  /** Extra direction from the designer on a regenerate. Empty on first run. */
  guidance: string;
  /** The previous attempt, so a regenerate refines rather than starts over. */
  previousHtml?: string;
}

export async function generateGuiTemplate({
  screenshots,
  profile,
  systemNameFictional,
  guidance,
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

  content.push({
    type: "text",
    text: [
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
        ? `Here is your previous attempt. Refine it rather than starting over.\n\n<previous>\n${previousHtml}\n</previous>`
        : "",
      guidance ? `Additional direction from the designer:\n${guidance}` : "",
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
.sim-console { display: flex; flex-direction: column; gap: 1px; background: #16202b; color: #cfe3f5; font-family: ui-monospace, monospace; min-height: 100%; }
.sim-console .bar { background: #0b1219; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
.sim-console .body { display: grid; grid-template-columns: 1fr 15rem; gap: 1px; flex: 1; }
.sim-console .pane { background: #0b1219; padding: 12px; min-height: 12rem; }
.sim-console .foot { background: #0b1219; padding: 12px 14px; min-height: 6rem; }
.sim-console h4 { font-size: 10px; letter-spacing: .12em; color: #6d8399; margin-bottom: 8px; }
</style>
<div class="sim-console">
  <div class="bar">
    <div data-slot="system-name"></div>
    <div data-slot="clock"></div>
  </div>
  <div class="body">
    <div class="pane"><h4>AIR PICTURE</h4><div data-slot="tracks"></div></div>
    <div class="pane"><h4>RESOURCES</h4><div data-slot="resources"></div></div>
  </div>
  <div class="foot"><div data-slot="decision"></div></div>
</div>`;
