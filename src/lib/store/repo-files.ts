import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config";

/**
 * A tiny file store whose backing medium is the git repository itself.
 *
 * Two implementations, chosen at runtime:
 *
 *   - `GitHubFiles`   — reads and writes through the GitHub Contents API, so
 *                       every save is a real commit. This is what runs in
 *                       production, where the serverless filesystem is
 *                       read-only and would lose writes anyway.
 *   - `LocalFiles`    — plain filesystem under the project root. This is what
 *                       runs during local development, where committing on
 *                       every keystroke would be tiresome.
 *
 * Callers see the same interface either way and never branch on which is which.
 */

export interface RepoFiles {
  /** File names (not full paths) directly inside `dir`. Missing dir ⇒ []. */
  list(dir: string): Promise<string[]>;
  /** Directory names directly inside `dir`. Missing dir ⇒ []. */
  listDirs(dir: string): Promise<string[]>;
  /** UTF-8 contents, or null if the file does not exist. */
  read(filePath: string): Promise<string | null>;
  /**
   * Base64 contents, or null if the file does not exist.
   *
   * Stored screenshots are read back this way: they are shown to the model
   * twice — once when interpreting the designer's answers, once when the
   * console is generated — so they have to come out of storage as bytes, not
   * as text.
   */
  readBase64(filePath: string): Promise<string | null>;
  write(filePath: string, contents: string, message: string): Promise<void>;
  writeBinary(filePath: string, bytes: Uint8Array, message: string): Promise<void>;
  remove(filePath: string, message: string): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Local filesystem                                                    */
/* ------------------------------------------------------------------ */

/**
 * Everything this store touches lives under `data/`. Scoping the root to that
 * one directory keeps the bundler from treating the whole project as reachable
 * from a dynamic path, and gives the traversal check below something to
 * enforce against.
 */
const DATA_ROOT = path.join(process.cwd(), "data");

class LocalFiles implements RepoFiles {
  private absolute(filePath: string): string {
    const relative = filePath.startsWith("data/")
      ? filePath.slice("data/".length)
      : filePath;
    const resolved = path.resolve(DATA_ROOT, relative);

    if (resolved !== DATA_ROOT && !resolved.startsWith(DATA_ROOT + path.sep)) {
      throw new Error(`Refusing to access a path outside data/: ${filePath}`);
    }
    return resolved;
  }

  async list(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.absolute(dir), {
        withFileTypes: true,
      });
      return entries.filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async listDirs(dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.absolute(dir), {
        withFileTypes: true,
      });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async read(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(this.absolute(filePath), "utf8");
    } catch {
      return null;
    }
  }

  async readBase64(filePath: string): Promise<string | null> {
    try {
      const bytes = await fs.readFile(this.absolute(filePath));
      return bytes.toString("base64");
    } catch {
      return null;
    }
  }

  async write(filePath: string, contents: string): Promise<void> {
    const target = this.absolute(filePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents, "utf8");
  }

  async writeBinary(filePath: string, bytes: Uint8Array): Promise<void> {
    const target = this.absolute(filePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }

  async remove(filePath: string): Promise<void> {
    await fs.rm(this.absolute(filePath), { force: true });
  }
}

/* ------------------------------------------------------------------ */
/* GitHub Contents API                                                 */
/* ------------------------------------------------------------------ */

/**
 * How many times a refused write will re-read the parent and try again.
 *
 * The queue below orders one instance's writes. Production has many instances:
 * a designer approving a profile while a trainee's scenario job records its
 * result is two writers on one branch, and the second commit is refused because
 * its parent moved. The losing write is never wrong, only late — so re-read and
 * repeat it rather than surfacing a conflict the user cannot act on.
 */
const CONFLICT_ATTEMPTS = 5;

/** A write refused only because the branch moved under it. */
class BranchMovedError extends Error {}

interface GitHubEntry {
  name: string;
  path: string;
  sha: string;
  type: string;
}

class GitHubFiles implements RepoFiles {
  private readonly base: string;
  private readonly branch: string;
  private readonly headers: Record<string, string>;

  /**
   * Mutations run one at a time.
   *
   * Every write is a commit, and the Contents API refuses a commit whose parent
   * has moved: two writes issued in parallel race, and the loser comes back
   * `409 is at <sha> but expected <sha>`. Uploading a handful of screenshots is
   * exactly that shape. Rather than making every caller remember to await in
   * sequence — a rule that is invisible until it is broken, and then only
   * sometimes — the store queues its own writes.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(owner: string, repo: string, branch: string, token: string) {
    this.base = `https://api.github.com/repos/${owner}/${repo}/contents`;
    this.branch = branch;
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };
  }

  private url(filePath: string): string {
    // Each segment is encoded separately so that slashes stay path separators.
    const encoded = filePath.split("/").map(encodeURIComponent).join("/");
    return `${this.base}/${encoded}`;
  }

  /** GET a path. Returns null on 404 so callers can treat "missing" as data. */
  private async get(filePath: string): Promise<unknown | null> {
    const response = await fetch(
      `${this.url(filePath)}?ref=${encodeURIComponent(this.branch)}`,
      { headers: this.headers, cache: "no-store" },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `GitHub read failed for ${filePath}: ${response.status} ${await response.text()}`,
      );
    }
    return response.json();
  }

  /** The blob SHA of an existing file, or undefined when creating a new one. */
  private async shaOf(filePath: string): Promise<string | undefined> {
    const existing = (await this.get(filePath)) as { sha?: string } | null;
    return existing?.sha;
  }

  async list(dir: string): Promise<string[]> {
    return this.namesOfType(dir, "file");
  }

  async listDirs(dir: string): Promise<string[]> {
    return this.namesOfType(dir, "dir");
  }

  private async namesOfType(dir: string, type: string): Promise<string[]> {
    const listing = await this.get(dir);
    if (!Array.isArray(listing)) return [];
    return (listing as GitHubEntry[])
      .filter((entry) => entry.type === type)
      .map((entry) => entry.name);
  }

  async read(filePath: string): Promise<string | null> {
    const file = (await this.get(filePath)) as
      | { content?: string; encoding?: string }
      | null;
    if (!file?.content) return null;
    return Buffer.from(file.content, "base64").toString("utf8");
  }

  async readBase64(filePath: string): Promise<string | null> {
    const file = (await this.get(filePath)) as
      | { content?: string; sha?: string }
      | null;
    if (!file) return null;

    // The API wraps base64 at 60 columns; the SDK wants it unbroken.
    if (file.content) return file.content.replace(/\s+/g, "");

    // Past a megabyte the Contents API returns the metadata without the body.
    // The blob endpoint still has it, and we already know the sha.
    if (!file.sha) return null;
    const response = await fetch(
      `${this.base.replace(/\/contents$/, "/git/blobs")}/${file.sha}`,
      { headers: this.headers, cache: "no-store" },
    );
    if (!response.ok) return null;
    const blob = (await response.json()) as { content?: string };
    return blob.content ? blob.content.replace(/\s+/g, "") : null;
  }

  /** Runs `work` after every mutation queued before it, failures included. */
  private oneAtATime<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    // A failed write must not wedge the queue for the writes behind it.
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private put(filePath: string, base64: string, message: string): Promise<void> {
    return this.oneAtATime(() =>
      this.retryingConflicts(() => this.putNow(filePath, base64, message)),
    );
  }

  /**
   * Repeats a write that lost a race for the branch.
   *
   * Each attempt re-reads the parent sha, so repeating is all that is needed.
   * The wait grows and is jittered, so two writers that collided once do not
   * march back into each other in step.
   */
  private async retryingConflicts(work: () => Promise<void>): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await work();
      } catch (reason) {
        if (!(reason instanceof BranchMovedError)) throw reason;
        if (attempt === CONFLICT_ATTEMPTS) throw reason;
        await new Promise((resolve) =>
          setTimeout(resolve, attempt * 150 + Math.random() * 150),
        );
      }
    }
  }

  private async putNow(
    filePath: string,
    base64: string,
    message: string,
  ): Promise<void> {
    const response = await fetch(this.url(filePath), {
      method: "PUT",
      headers: this.headers,
      cache: "no-store",
      body: JSON.stringify({
        message,
        content: base64,
        branch: this.branch,
        sha: await this.shaOf(filePath),
      }),
    });
    if (response.status === 409) {
      throw new BranchMovedError(`Branch moved while writing ${filePath}`);
    }
    if (!response.ok) {
      throw new Error(await describeWriteFailure(response, filePath));
    }
  }

  async write(filePath: string, contents: string, message: string): Promise<void> {
    await this.put(filePath, Buffer.from(contents, "utf8").toString("base64"), message);
  }

  async writeBinary(
    filePath: string,
    bytes: Uint8Array,
    message: string,
  ): Promise<void> {
    await this.put(filePath, Buffer.from(bytes).toString("base64"), message);
  }

  remove(filePath: string, message: string): Promise<void> {
    return this.oneAtATime(() =>
      this.retryingConflicts(() => this.removeNow(filePath, message)),
    );
  }

  private async removeNow(filePath: string, message: string): Promise<void> {
    const sha = await this.shaOf(filePath);
    if (!sha) return;
    const response = await fetch(this.url(filePath), {
      method: "DELETE",
      headers: this.headers,
      cache: "no-store",
      body: JSON.stringify({ message, sha, branch: this.branch }),
    });
    if (response.status === 409) {
      throw new BranchMovedError(`Branch moved while deleting ${filePath}`);
    }
    if (!response.ok) {
      throw new Error(await describeWriteFailure(response, filePath));
    }
  }
}

/**
 * Turns a refused write into something the person reading it can act on.
 *
 * The raw body of a 403 here is `Resource not accessible by personal access
 * token`, which is accurate and tells nobody what to do. The cause is almost
 * always the same one, so name it and name the fix.
 */
async function describeWriteFailure(
  response: Response,
  filePath: string,
): Promise<string> {
  if (response.status === 403) {
    return (
      "GitHub refused the write: the token does not have permission to change " +
      "this repository's contents. In the token's settings, set Repository " +
      'permissions → Contents to "Read and write" — the token itself does not ' +
      "change, so Vercel needs no redeploy."
    );
  }
  if (response.status === 401) {
    return "GitHub rejected the token — it is expired or invalid. Issue a new one and update GITHUB_TOKEN in Vercel.";
  }
  if (response.status === 404) {
    return "GitHub could not find the repository or branch to write to. Check GITHUB_REPO and GITHUB_BRANCH.";
  }
  return `GitHub write failed for ${filePath}: ${response.status} ${await response.text()}`;
}

/* ------------------------------------------------------------------ */

let instance: RepoFiles | undefined;

export function repoFiles(): RepoFiles {
  if (!instance) {
    const { enabled, owner, repo, branch, token } = config.github;
    instance = enabled
      ? new GitHubFiles(owner!, repo!, branch, token!)
      : new LocalFiles();
  }
  return instance;
}

/** True when saves become commits. The UI says so, so the user knows where data went. */
export function isGitBacked(): boolean {
  return config.github.enabled;
}

/**
 * Whether the configured token can actually *write* to the repository.
 *
 * `isGitBacked()` only says the variables are set. A token that is present but
 * read-only passes that check, shows a green status board, and then fails on
 * the first save with a raw 403 — after the user has already typed everything
 * in. GitHub reports the token's effective rights on the repository itself, so
 * the board can say so up front instead.
 *
 * Read-only and cheap: one GET, no writes, and it never reports a token value.
 */
export async function githubWriteAccess(): Promise<
  { ok: true } | { ok: false; problem: string }
> {
  const { enabled, owner, repo, branch, token } = config.github;
  if (!enabled) return { ok: false, problem: "GitHub is not configured." };

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      },
    );

    if (response.status === 401) {
      return { ok: false, problem: "The token was rejected — it is expired or invalid." };
    }
    if (response.status === 404) {
      return {
        ok: false,
        problem: `The token cannot see ${owner}/${repo}. Check GITHUB_REPO, and that the token grants access to this repository.`,
      };
    }
    if (!response.ok) {
      return { ok: false, problem: `GitHub replied ${response.status}.` };
    }

    const body = (await response.json()) as {
      permissions?: { push?: boolean };
      default_branch?: string;
    };

    if (body.permissions?.push !== true) {
      return {
        ok: false,
        problem:
          "The token can read this repository but not write to it. In the token's settings, set Repository permissions → Contents to \"Read and write\".",
      };
    }

    // A write also needs the branch to exist; a typo in GITHUB_BRANCH fails the
    // same way a missing permission does, and is just as invisible until a save.
    const ref = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        cache: "no-store",
      },
    );
    if (ref.status === 404) {
      return {
        ok: false,
        problem: `The branch "${branch}" does not exist in ${owner}/${repo}. Check GITHUB_BRANCH.`,
      };
    }

    return { ok: true };
  } catch (reason) {
    return {
      ok: false,
      problem:
        reason instanceof Error
          ? `Could not reach GitHub: ${reason.message}`
          : "Could not reach GitHub.",
    };
  }
}
