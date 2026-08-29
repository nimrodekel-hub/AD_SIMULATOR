"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readJson } from "@/lib/http";

/**
 * Naming a new simulated system.
 *
 * Creating it is deliberately this small: a system exists as soon as it has a
 * name, and the behaviour profile, console and dilemmas are filled in
 * afterwards, each on its own screen. That way a designer can start a second
 * system without finishing the first.
 */
export function NewSystemForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/systems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), note: note.trim() }),
      });
      const payload = await readJson<{ error?: string; system: { id: string } }>(
        response,
      );
      if (!response.ok) throw new Error(payload.error ?? "Could not create it.");

      // Straight into setup: naming a system is the start of the work, not the
      // end of it.
      router.push(`/designer/systems/${payload.system.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create it.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-3">
        <input
          className="field w-64"
          placeholder="e.g. Sentinel-7"
          aria-label="System name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <input
          className="field min-w-64 flex-1"
          placeholder="One line, for your own reference (optional)"
          aria-label="Note"
          value={note}
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || name.trim().length === 0}
          onClick={() => void create()}
        >
          {busy ? "Creating…" : "Create system"}
        </button>
      </div>

      {error ? <p className="chip status-danger !normal-case">{error}</p> : null}
    </div>
  );
}
