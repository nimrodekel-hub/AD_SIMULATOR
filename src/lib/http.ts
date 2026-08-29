/**
 * Reading a response from this app's own API, safely.
 *
 * Every failure the app itself produces answers with JSON, so callers could
 * just use `response.json()`. The platform underneath does not: a request over
 * the serverless body limit, a function that ran out of time, or a bad gateway
 * all come back as HTML or plain text. Calling `.json()` on those throws a
 * parser error — in Safari, "The string did not match the expected pattern." —
 * which replaces the real cause with a message about syntax, and leaves the
 * person looking at it with nothing to act on.
 *
 * So: read the body once as text, parse it if it is JSON, and otherwise report
 * what the status actually means.
 */

/** Vercel refuses a request body larger than this before our code ever runs. */
export const MAX_REQUEST_BYTES = 4.5 * 1024 * 1024;

export async function readJson<T>(response: Response): Promise<T> {
  const body = await response.text();

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(explainNonJson(response.status));
  }
}

function explainNonJson(status: number): string {
  switch (status) {
    case 413:
      return "The upload was too large to accept. Send fewer or smaller files.";
    case 504:
    case 408:
      return "The request took too long and was cut off before it finished. Try again — if it keeps happening, shorten your answers or store fewer screenshots.";
    case 502:
    case 503:
      return "The server was unreachable for a moment. Try again.";
    case 401:
    case 403:
      return "The request was refused before it reached the app.";
    default:
      return `The server answered ${status} without a readable explanation. If it keeps happening, the deployment logs will have the detail.`;
  }
}

/** Human-readable byte size, for messages about upload limits. */
export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
