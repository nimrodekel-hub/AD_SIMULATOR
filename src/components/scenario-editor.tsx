"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ScenarioForm } from "@/components/scenario-form";
import type { ScenarioDraft, ScenarioEntry } from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";

/**
 * Review an existing entry, correct it, and — when it is right — approve it.
 *
 * Approval is what makes an entry visible to trainees, so it is a separate,
 * deliberate action rather than a side effect of saving.
 */
export function ScenarioEditor({
  systemId,
  entry,
}: {
  systemId: string;
  entry: ScenarioEntry;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function save(draft: ScenarioDraft) {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const response = await fetch(`/api/systems/${systemId}/scenarios/${entry.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Save failed.");
      setNotice("Saved.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    setApproving(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/systems/${systemId}/scenarios/${entry.id}/approve`, {
        method: "POST",
      });
      const payload = await readJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Approval failed.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Approval failed.");
    } finally {
      setApproving(false);
    }
  }

  const isDraft = entry.status === "draft";

  return (
    <div>
      <div className="panel mb-6 flex flex-wrap items-center gap-4 p-4">
        <span className={`chip ${isDraft ? "status-warn" : "status-ok"}`}>
          {entry.status}
        </span>
        <p className="flex-1 text-sm text-muted">
          {isDraft
            ? "Not yet visible to trainees. Approve it to make it available for matching."
            : `Approved ${entry.approved_at ? new Date(entry.approved_at).toLocaleString() : ""} and available to trainees.`}
        </p>
        {isDraft ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void approve()}
            disabled={approving}
          >
            {approving ? "Approving…" : "Approve & publish"}
          </button>
        ) : null}
      </div>

      {notice ? <p className="chip status-ok mb-4 !normal-case">{notice}</p> : null}

      <ScenarioForm
        initial={toDraft(entry)}
        saving={saving}
        error={error}
        primaryLabel="Save changes"
        onSubmit={save}
      />
    </div>
  );
}

/** Strips the server-owned fields, leaving just the editable content. */
function toDraft(entry: ScenarioEntry): ScenarioDraft {
  return {
    title: entry.title,
    sub_domain_tag: entry.sub_domain_tag,
    trigger_conditions: entry.trigger_conditions,
    key_variables: entry.key_variables,
    dilemmas: entry.dilemmas,
    difficulty_scaling: entry.difficulty_scaling,
    evaluation_criteria: entry.evaluation_criteria,
  };
}
