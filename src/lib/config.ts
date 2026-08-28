import "server-only";

/**
 * Central place where every environment variable is read. Nothing else in the
 * codebase touches `process.env`, so what the app needs to run is answerable by
 * reading one file.
 *
 * Secrets live only here and in the server modules that import this. None of
 * these values are ever sent to the browser.
 */

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

const githubRepo = optional("GITHUB_REPO");
const githubToken = optional("GITHUB_TOKEN");

/** Split "owner/name" once, at startup, rather than at every call site. */
const [githubOwner, githubName] = githubRepo?.split("/") ?? [];

export const config = {
  anthropic: {
    apiKey: optional("ANTHROPIC_API_KEY"),
    /** Overridable so the model can be changed without a code deploy. */
    model: optional("ANTHROPIC_MODEL") ?? "claude-opus-5",
    /**
     * Returns canned responses instead of calling the API. Lets the whole app be
     * clicked through before a key is configured. Set AI_MOCK=1 to force it on;
     * it also turns itself on when no key is present, so a missing key surfaces
     * as obviously-fake content rather than a stack trace.
     */
    mock: process.env.AI_MOCK === "1" || !optional("ANTHROPIC_API_KEY"),
  },

  /**
   * Everything this app stores — the knowledge base and the session log alike —
   * lives as JSON files in the git repository. When these are set the app reads
   * and writes them through the GitHub API; otherwise it falls back to the local
   * filesystem, which is what happens during local development.
   *
   * Required in production: the serverless filesystem is read-only, so without
   * these nothing saved would survive a request, let alone a deploy.
   */
  github: {
    token: githubToken,
    owner: githubOwner,
    repo: githubName,
    branch: optional("GITHUB_BRANCH") ?? "claude/air-defense-simulator-bwmstp",
    enabled: Boolean(githubToken && githubOwner && githubName),
  },
} as const;

/**
 * Names the specific thing wrong with the GitHub configuration, for the status
 * board to show.
 *
 * "Storage: local filesystem" tells an operator that saving is broken but not
 * which of three variables to go and fix — and on a hosted deployment they
 * cannot read the logs to find out. Never reports a value, only whether one is
 * present and well-formed.
 */
export function githubConfigProblems(): string[] {
  const problems: string[] = [];

  if (!githubToken) problems.push("GITHUB_TOKEN is not set");

  if (!githubRepo) {
    problems.push("GITHUB_REPO is not set");
  } else if (!githubOwner || !githubName) {
    problems.push(
      `GITHUB_REPO must look like "owner/name" — it is currently "${githubRepo}"`,
    );
  }

  return problems;
}

/**
 * Where everything lives inside the repository.
 *
 * Each simulated system owns a directory, and everything that only makes sense
 * inside that system lives under it: how it behaves, its console, its
 * reference screenshots and the dilemmas taught within it. Listing one
 * system's dilemmas is then a single directory read rather than a scan of
 * every dilemma in the repository.
 */
export const DATA_PATHS = {
  systems: "data/kb/systems",
  sessions: "data/sessions",
  trainees: "data/trainees.json",
} as const;

/** The files and directories inside one system's directory. */
export const systemPaths = (systemId: string) => {
  const root = `${DATA_PATHS.systems}/${systemId}`;
  return {
    root,
    system: `${root}/system.json`,
    profile: `${root}/profile.json`,
    gui: `${root}/gui.json`,
    screenshots: `${root}/screenshots`,
    dilemmas: `${root}/dilemmas`,
  };
};
