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
  /** UTF-8 contents, or null if the file does not exist. */
  read(filePath: string): Promise<string | null>;
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

  async read(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(this.absolute(filePath), "utf8");
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
    const listing = await this.get(dir);
    if (!Array.isArray(listing)) return [];
    return (listing as GitHubEntry[])
      .filter((entry) => entry.type === "file")
      .map((entry) => entry.name);
  }

  async read(filePath: string): Promise<string | null> {
    const file = (await this.get(filePath)) as
      | { content?: string; encoding?: string }
      | null;
    if (!file?.content) return null;
    return Buffer.from(file.content, "base64").toString("utf8");
  }

  private async put(
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
    if (!response.ok) {
      throw new Error(
        `GitHub write failed for ${filePath}: ${response.status} ${await response.text()}`,
      );
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

  async remove(filePath: string, message: string): Promise<void> {
    const sha = await this.shaOf(filePath);
    if (!sha) return;
    const response = await fetch(this.url(filePath), {
      method: "DELETE",
      headers: this.headers,
      cache: "no-store",
      body: JSON.stringify({ message, sha, branch: this.branch }),
    });
    if (!response.ok) {
      throw new Error(
        `GitHub delete failed for ${filePath}: ${response.status} ${await response.text()}`,
      );
    }
  }
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
