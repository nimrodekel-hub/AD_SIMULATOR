import "server-only";
import { DATA_PATHS } from "../config";
import {
  DilemmaEntrySchema,
  GuiTemplateSchema,
  type DilemmaDraft,
  type DilemmaEntry,
  type GuiTemplate,
} from "../domain/schemas";
import { repoFiles } from "./repo-files";

/**
 * The knowledge base: dilemma entries and the simulated-GUI template, stored as
 * one JSON file per record inside the repository.
 *
 * Files rather than database rows because this is the content a domain expert
 * authors and cares about keeping: a commit per approval gives a reviewable
 * history of how the operational knowledge evolved, and the files stay readable
 * and hand-editable if the AI extraction ever gets something subtly wrong.
 */

const fileFor = (id: string) => `${DATA_PATHS.dilemmas}/${id}.json`;
const GUI_FILE = `${DATA_PATHS.gui}/template.json`;

function serialise(value: unknown): string {
  // Trailing newline keeps the file POSIX-clean and the diffs quiet.
  return `${JSON.stringify(value, null, 2)}\n`;
}

/* ------------------------------------------------------------------ */
/* Dilemma entries                                                     */
/* ------------------------------------------------------------------ */

export async function listDilemmas(): Promise<DilemmaEntry[]> {
  const files = await repoFiles().list(DATA_PATHS.dilemmas);
  const entries = await Promise.all(
    files
      .filter((name) => name.endsWith(".json"))
      .map((name) => getDilemma(name.replace(/\.json$/, ""))),
  );

  return entries
    .filter((entry): entry is DilemmaEntry => entry !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function listApprovedDilemmas(): Promise<DilemmaEntry[]> {
  return (await listDilemmas()).filter((entry) => entry.status === "approved");
}

export async function getDilemma(id: string): Promise<DilemmaEntry | null> {
  const raw = await repoFiles().read(fileFor(id));
  if (raw === null) return null;

  const parsed = DilemmaEntrySchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    // A malformed file is worth surfacing, but it must not take down the whole
    // list — the other dilemmas are still usable.
    console.error(`Skipping malformed dilemma ${id}:`, parsed.error.message);
    return null;
  }
  return parsed.data;
}

/** Creates a new draft entry from a freshly extracted dilemma. */
export async function createDilemmaDraft(
  draft: DilemmaDraft,
  sourceChatLog: string,
): Promise<DilemmaEntry> {
  const entry: DilemmaEntry = {
    ...draft,
    id: crypto.randomUUID(),
    status: "draft",
    source_chat_log: sourceChatLog,
    created_at: new Date().toISOString(),
    approved_at: null,
  };
  await saveDilemma(entry, `Add dilemma draft: ${entry.title}`);
  return entry;
}

export async function saveDilemma(
  entry: DilemmaEntry,
  message?: string,
): Promise<void> {
  const validated = DilemmaEntrySchema.parse(entry);
  await repoFiles().write(
    fileFor(validated.id),
    serialise(validated),
    message ?? `Update dilemma: ${validated.title}`,
  );
}

/** Flips a draft to approved, which is what makes it visible to trainees. */
export async function approveDilemma(id: string): Promise<DilemmaEntry | null> {
  const entry = await getDilemma(id);
  if (!entry) return null;

  const approved: DilemmaEntry = {
    ...entry,
    status: "approved",
    approved_at: new Date().toISOString(),
  };
  await saveDilemma(approved, `Approve dilemma: ${approved.title}`);
  return approved;
}

export async function deleteDilemma(id: string): Promise<void> {
  await repoFiles().remove(fileFor(id), `Remove dilemma ${id}`);
}

/* ------------------------------------------------------------------ */
/* Simulated GUI template                                              */
/* ------------------------------------------------------------------ */

/**
 * The POC keeps exactly one GUI template — section 3 of the brief rules out
 * runtime GUI generation, so there is one simulated console and every scenario
 * renders inside it.
 */
export async function getGuiTemplate(): Promise<GuiTemplate | null> {
  const raw = await repoFiles().read(GUI_FILE);
  if (raw === null) return null;

  const parsed = GuiTemplateSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error("Skipping malformed GUI template:", parsed.error.message);
    return null;
  }
  return parsed.data;
}

export async function saveGuiTemplate(template: GuiTemplate): Promise<void> {
  const validated = GuiTemplateSchema.parse(template);
  await repoFiles().write(
    GUI_FILE,
    serialise(validated),
    `Update simulated GUI template: ${validated.system_name_fictional}`,
  );
}

/** Stores an uploaded reference screenshot and returns its repo-relative path. */
export async function saveScreenshot(
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `${DATA_PATHS.screenshots}/${crypto.randomUUID()}-${safeName}`;
  await repoFiles().writeBinary(filePath, bytes, `Add GUI reference ${safeName}`);
  return filePath;
}
