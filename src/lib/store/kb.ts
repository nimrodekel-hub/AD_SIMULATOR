import "server-only";
import { DATA_PATHS, systemPaths } from "../config";
import {
  DilemmaEntrySchema,
  GuiTemplateSchema,
  SimulatedSystemSchema,
  SystemProfileSchema,
  type DilemmaDraft,
  type DilemmaEntry,
  type GuiTemplate,
  type SimulatedSystem,
  type SystemProfile,
} from "../domain/schemas";
import { repoFiles } from "./repo-files";

/**
 * The knowledge base, organised by simulated system.
 *
 * Several systems exist side by side, and each one owns everything that only
 * makes sense inside it: how it behaves, what its console looks like, the
 * screenshots it was built from, and the dilemmas taught within it. A dilemma
 * is a judgement call *within* a system — its numbers, its identification
 * states and the actions it offers are only meaningful there — so it is stored
 * there rather than in a shared pool.
 *
 * Files rather than database rows because this is the content a domain expert
 * authors and cares about keeping: a commit per approval gives a reviewable
 * history of how the operational knowledge evolved, and the files stay readable
 * and hand-editable if the AI extraction ever gets something subtly wrong.
 */

function serialise(value: unknown): string {
  // Trailing newline keeps the file POSIX-clean and the diffs quiet.
  return `${JSON.stringify(value, null, 2)}\n`;
}

/* ------------------------------------------------------------------ */
/* Systems                                                             */
/* ------------------------------------------------------------------ */

export async function listSystems(): Promise<SimulatedSystem[]> {
  const ids = await repoFiles().listDirs(DATA_PATHS.systems);
  const systems = await Promise.all(ids.map((id) => getSystem(id)));

  return systems
    .filter((system): system is SimulatedSystem => system !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getSystem(id: string): Promise<SimulatedSystem | null> {
  const raw = await repoFiles().read(systemPaths(id).system);
  if (raw === null) return null;

  const parsed = SimulatedSystemSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    // A malformed record is worth surfacing, but it must not take down the
    // whole list — the other systems are still usable.
    console.error(`Skipping malformed system ${id}:`, parsed.error.message);
    return null;
  }
  return parsed.data;
}

export async function createSystem(
  name: string,
  note: string,
): Promise<SimulatedSystem> {
  const system: SimulatedSystem = {
    id: crypto.randomUUID(),
    name,
    note,
    created_at: new Date().toISOString(),
  };
  await saveSystem(system, `Add simulated system: ${name}`);
  return system;
}

export async function saveSystem(
  system: SimulatedSystem,
  message?: string,
): Promise<void> {
  const validated = SimulatedSystemSchema.parse(system);
  await repoFiles().write(
    systemPaths(validated.id).system,
    serialise(validated),
    message ?? `Update simulated system: ${validated.name}`,
  );
}

/**
 * Everything about a system, in one read, for the screens that show its state.
 *
 * The three parts are independent: a system can be named before it is
 * described, described before its console is built, and either of those can be
 * a draft. The setup screens read all three to decide what to allow next.
 */
export async function getSystemBundle(id: string): Promise<{
  system: SimulatedSystem | null;
  profile: SystemProfile | null;
  gui: GuiTemplate | null;
  dilemmas: DilemmaEntry[];
}> {
  const [system, profile, gui, dilemmas] = await Promise.all([
    getSystem(id),
    getSystemProfile(id),
    getGuiTemplate(id),
    listDilemmas(id),
  ]);
  return { system, profile, gui, dilemmas };
}

/* ------------------------------------------------------------------ */
/* System profile — how one system behaves                             */
/* ------------------------------------------------------------------ */

/**
 * Read by scenario generation, debriefing and the console builder alike. One
 * per system, and only an approved one governs anything.
 */
export async function getSystemProfile(
  systemId: string,
): Promise<SystemProfile | null> {
  const raw = await repoFiles().read(systemPaths(systemId).profile);
  if (raw === null) return null;

  const parsed = SystemProfileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(
      `Skipping malformed profile for system ${systemId}:`,
      parsed.error.message,
    );
    return null;
  }
  return parsed.data;
}

export async function saveSystemProfile(
  systemId: string,
  profile: SystemProfile,
  systemName: string,
): Promise<void> {
  const validated = SystemProfileSchema.parse(profile);
  await repoFiles().write(
    systemPaths(systemId).profile,
    serialise(validated),
    validated.approved
      ? `Approve behaviour profile: ${systemName}`
      : `Update behaviour profile draft: ${systemName}`,
  );
}

/* ------------------------------------------------------------------ */
/* Simulated console                                                   */
/* ------------------------------------------------------------------ */

/**
 * One console template per system — section 3 of the brief rules out runtime
 * GUI generation, so a system's console is built once and every scenario on
 * that system renders inside it.
 */
export async function getGuiTemplate(
  systemId: string,
): Promise<GuiTemplate | null> {
  const raw = await repoFiles().read(systemPaths(systemId).gui);
  if (raw === null) return null;

  const parsed = GuiTemplateSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(
      `Skipping malformed console template for system ${systemId}:`,
      parsed.error.message,
    );
    return null;
  }
  return parsed.data;
}

export async function saveGuiTemplate(
  systemId: string,
  template: GuiTemplate,
  systemName: string,
): Promise<void> {
  const validated = GuiTemplateSchema.parse(template);
  await repoFiles().write(
    systemPaths(systemId).gui,
    serialise(validated),
    `Update simulated console: ${systemName}`,
  );
}

/* ------------------------------------------------------------------ */
/* Reference screenshots — evidence, read twice                        */
/* ------------------------------------------------------------------ */

/**
 * The screenshots belong to the system, not to the console step.
 *
 * They are shown to the model twice: once when it reads the designer's answers
 * about how the system behaves, and again when the console is generated. A
 * screenshot settles what the columns are called and in what order they sit far
 * better than a sentence describing them, so it is worth having in hand while
 * the answers are being interpreted — not only afterwards.
 */

export interface StoredScreenshot {
  /** Repo-relative path, kept on the template as its provenance. */
  path: string;
  mediaType: string;
  base64: string;
}

/** Stores an uploaded reference screenshot and returns its repo-relative path. */
export async function saveScreenshot(
  systemId: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<string> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `${systemPaths(systemId).screenshots}/${crypto.randomUUID()}-${safeName}`;
  await repoFiles().writeBinary(filePath, bytes, `Add console reference ${safeName}`);
  return filePath;
}

/** File names of the stored references, oldest upload first. */
export async function listScreenshots(systemId: string): Promise<string[]> {
  const names = await repoFiles().list(systemPaths(systemId).screenshots);
  return names.filter((name) => MEDIA_TYPES[extensionOf(name)] !== undefined).sort();
}

/** The stored references as image blocks, ready to hand to the model. */
export async function loadScreenshots(
  systemId: string,
): Promise<StoredScreenshot[]> {
  const root = systemPaths(systemId).screenshots;
  const names = await listScreenshots(systemId);

  const loaded = await Promise.all(
    names.map(async (name) => {
      const base64 = await repoFiles().readBase64(`${root}/${name}`);
      return base64
        ? { path: `${root}/${name}`, mediaType: MEDIA_TYPES[extensionOf(name)], base64 }
        : null;
    }),
  );

  // A reference that cannot be read back is dropped rather than failing the
  // step: the remaining ones are still worth showing the model.
  return loaded.filter((shot): shot is StoredScreenshot => shot !== null);
}

/**
 * Replaces the whole reference set.
 *
 * Uploading is "these are the screenshots of this system", not "add one more",
 * so a second upload supersedes the first rather than accumulating a pile
 * nobody remembers the order of.
 */
export async function replaceScreenshots(
  systemId: string,
  files: Array<{ name: string; bytes: Uint8Array }>,
): Promise<string[]> {
  const root = systemPaths(systemId).screenshots;
  const existing = await repoFiles().list(root);

  await Promise.all(
    existing.map((name) =>
      repoFiles().remove(`${root}/${name}`, "Replace console references"),
    ),
  );

  return Promise.all(
    files.map((file) => saveScreenshot(systemId, file.name, file.bytes)),
  );
}

const MEDIA_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const extensionOf = (name: string) =>
  name.slice(name.lastIndexOf(".") + 1).toLowerCase();

/* ------------------------------------------------------------------ */
/* Dilemmas — one system's captured expertise                          */
/* ------------------------------------------------------------------ */

const dilemmaFile = (systemId: string, id: string) =>
  `${systemPaths(systemId).dilemmas}/${id}.json`;

export async function listDilemmas(systemId: string): Promise<DilemmaEntry[]> {
  const files = await repoFiles().list(systemPaths(systemId).dilemmas);
  const entries = await Promise.all(
    files
      .filter((name) => name.endsWith(".json"))
      .map((name) => getDilemma(systemId, name.replace(/\.json$/, ""))),
  );

  return entries
    .filter((entry): entry is DilemmaEntry => entry !== null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Every dilemma in every system.
 *
 * Only the instructor's views need this: they report on runs across all
 * systems, so they need to resolve a title without knowing which system a run
 * belonged to. Training never uses it — matching is always scoped to one
 * system.
 */
export async function listAllDilemmas(): Promise<DilemmaEntry[]> {
  const systems = await listSystems();
  const perSystem = await Promise.all(
    systems.map((system) => listDilemmas(system.id)),
  );
  return perSystem.flat();
}

export async function listApprovedDilemmas(
  systemId: string,
): Promise<DilemmaEntry[]> {
  return (await listDilemmas(systemId)).filter(
    (entry) => entry.status === "approved",
  );
}

export async function getDilemma(
  systemId: string,
  id: string,
): Promise<DilemmaEntry | null> {
  const raw = await repoFiles().read(dilemmaFile(systemId, id));
  if (raw === null) return null;

  const parsed = DilemmaEntrySchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(`Skipping malformed dilemma ${id}:`, parsed.error.message);
    return null;
  }
  return parsed.data;
}

/** Creates a new draft entry from a freshly extracted dilemma. */
export async function createDilemmaDraft(
  systemId: string,
  draft: DilemmaDraft,
  sourceChatLog: string,
): Promise<DilemmaEntry> {
  const entry: DilemmaEntry = {
    ...draft,
    id: crypto.randomUUID(),
    system_id: systemId,
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
    dilemmaFile(validated.system_id, validated.id),
    serialise(validated),
    message ?? `Update dilemma: ${validated.title}`,
  );
}

/** Flips a draft to approved, which is what makes it visible to trainees. */
export async function approveDilemma(
  systemId: string,
  id: string,
): Promise<DilemmaEntry | null> {
  const entry = await getDilemma(systemId, id);
  if (!entry) return null;

  const approved: DilemmaEntry = {
    ...entry,
    status: "approved",
    approved_at: new Date().toISOString(),
  };
  await saveDilemma(approved, `Approve dilemma: ${approved.title}`);
  return approved;
}

export async function deleteDilemma(
  systemId: string,
  id: string,
): Promise<void> {
  await repoFiles().remove(dilemmaFile(systemId, id), `Remove dilemma ${id}`);
}
