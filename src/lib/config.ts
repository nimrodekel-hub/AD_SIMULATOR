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
   * The knowledge base (dilemmas + GUI template) is stored as JSON files in the
   * git repository. When these are set the app reads and writes them through the
   * GitHub API; otherwise it falls back to the local filesystem, which is what
   * happens during local development.
   */
  github: {
    token: githubToken,
    owner: githubOwner,
    repo: githubName,
    branch: optional("GITHUB_BRANCH") ?? "claude/air-defense-simulator-bwmstp",
    /** Only the GitHub backend can write on Vercel — the filesystem is read-only there. */
    enabled: Boolean(githubToken && githubOwner && githubName),
  },

  /**
   * Session logs live in libSQL (SQLite). Locally that is a file; in production
   * it is a Turso database, which is the same engine over the network.
   */
  db: {
    url: optional("TURSO_DATABASE_URL") ?? "file:./data/local.db",
    authToken: optional("TURSO_AUTH_TOKEN"),
  },
} as const;

/** Where KB files live inside the repository. */
export const DATA_PATHS = {
  dilemmas: "data/kb/dilemmas",
  gui: "data/kb/gui",
  screenshots: "data/kb/gui/screenshots",
} as const;
