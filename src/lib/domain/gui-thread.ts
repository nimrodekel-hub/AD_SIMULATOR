import type { GuiRevision } from "./schemas";

/**
 * The record of a console's changes, reconciled with a build.
 *
 * Two halves have to be married. A finished build knows **which requests it
 * answers** — the list is stored with it, so it survives the page that asked.
 * The console knows **what came back for each** — the model's account of what
 * it changed, and when that was accepted.
 *
 * Matching them by position keeps every entry already recorded and adds one
 * only for the request that has not been answered yet. That matters in two
 * places for the same reason: the builder reopened after a build finished
 * elsewhere, and the review screen accepting a build the builder never saw.
 * Both need the same list, and computing it twice by hand is how the two
 * screens would start disagreeing about the history.
 *
 * A new entry gets no timestamp. It is not saved yet, and stamping it with
 * "now" would date the request to the moment the page happened to be opened.
 */
export function threadFor(
  requests: string[],
  stored: GuiRevision[],
  notesForNew: string,
): GuiRevision[] {
  return requests.map((request, index) =>
    stored[index]?.request === request
      ? stored[index]
      : { request, notes: notesForNew, at: "" },
  );
}

/**
 * Stamps whichever entries are being written now.
 *
 * Called on the way into storage, so an accepted change carries the time it
 * was accepted rather than the time it was typed — which nothing records, and
 * which would be the more useful of the two if it did.
 */
export function stamped(thread: GuiRevision[]): GuiRevision[] {
  const now = new Date().toISOString();
  return thread.map((entry) => (entry.at ? entry : { ...entry, at: now }));
}
