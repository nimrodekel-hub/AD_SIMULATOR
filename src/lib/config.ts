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
    /** The default for every step. Overridable without a code deploy. */
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
 * Which model runs one step.
 *
 * One model for the whole app was the right start and is the wrong end: these
 * steps are not the same kind of work. Routing a request to one of a handful
 * of scenarios is a classification that measured at nine seconds. Laying out an
 * engagement inside a system's declared envelope, or copying a console from
 * screenshots, is judgement — and it is the part a designer has already sent
 * back three times for not being good enough.
 *
 * So the choice is per step. `ANTHROPIC_MODEL` sets the default for all of
 * them; `ANTHROPIC_MODEL_<STEP>` overrides one. The step names are the labels
 * the usage log already prints, upper-cased with anything else as underscores:
 *
 *     ANTHROPIC_MODEL_MATCH               routing a trainee's request
 *     ANTHROPIC_MODEL_EXTRACT_NARRATIVE   tidying prose into lists
 *     ANTHROPIC_MODEL_EXERCISE            laying out an engagement
 *     ANTHROPIC_MODEL_EXERCISE_REVISION   correcting one
 *     ANTHROPIC_MODEL_CONSOLE             building the console
 *     ANTHROPIC_MODEL_DEBRIEF             judging a run
 *     ANTHROPIC_MODEL_INTERVIEW           the designer's conversation
 *     ANTHROPIC_MODEL_EXTRACT_SCENARIO     extracting a scenario from it
 *
 * Both are read at request time rather than at build time, so a step can be
 * moved to a cheaper model, watched, and moved back from Vercel's environment
 * variables without a deploy. That matters more than the saving: it is what
 * makes the tradeoff reversible in a minute instead of a release.
 */
export function modelFor(label: string): string {
  const suffix = label.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return optional(`ANTHROPIC_MODEL_${suffix}`) ?? config.anthropic.model;
}

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
 * reference screenshots and the scenarios taught within it. Listing one
 * system's scenarios is then a single directory read rather than a scan of
 * every scenario in the repository.
 */
export const DATA_PATHS = {
  systems: "data/kb/systems",
  sessions: "data/sessions",
  trainees: "data/trainees.json",
  /**
   * Work in progress that belongs to a person rather than to a system.
   *
   * One file per trainee, overwritten by their next run, so these never
   * accumulate.
   */
  jobs: "data/jobs",
  /**
   * Knowledge that sits above every system: the general briefing and the
   * lessons. One document for the whole app, edited by the designer.
   */
  generalKnowledge: "data/kb/general-knowledge.json",
} as const;

/** Where a trainee's in-flight exercise generation is recorded. */
export const exerciseJobPath = (traineeId: string) =>
  `${DATA_PATHS.jobs}/exercise-${traineeId}.json`;

/** The files and directories inside one system's directory. */
export const systemPaths = (systemId: string) => {
  const root = `${DATA_PATHS.systems}/${systemId}`;
  return {
    root,
    system: `${root}/system.json`,
    profile: `${root}/profile.json`,
    gui: `${root}/gui.json`,
    guiJob: `${root}/gui-job.json`,
    scenarioJob: `${root}/scenario-job.json`,
    screenshots: `${root}/screenshots`,
    scenarios: `${root}/scenarios`,
    /** Exercises a designer has taken hold of, and the corrected versions. */
    exercises: `${root}/exercises`,
  };
};
