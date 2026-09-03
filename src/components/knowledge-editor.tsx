"use client";

import { useState } from "react";
import type { GeneralKnowledge, Lesson } from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";

/**
 * The step before any system — general air-defence knowledge, edited by hand.
 *
 * Deliberately a plain editor with no AI anywhere in it. Everything else in
 * this app hands writing to a model and asks a person to check it; this is the
 * one place where the person writes and the model reads. That is the point: it
 * is the layer that tells the interviewer what is generally true, and if a
 * model wrote it there would be nothing anchoring it to anyone's experience.
 *
 * Two parts, because they change at different rates. The briefing is prose that
 * gets refined occasionally. Lessons accumulate one at a time, usually straight
 * after an interview where something proved true again — so they are a list you
 * can append to without opening the prose at all.
 */

interface Draft {
  id?: string;
  title: string;
  body: string;
}

export function KnowledgeEditor({ initial }: { initial: GeneralKnowledge }) {
  const [briefing, setBriefing] = useState(initial.briefing);
  const [lessons, setLessons] = useState<Draft[]>(initial.lessons);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState(initial.updated_at);

  function touch() {
    setNotice(undefined);
    setError(undefined);
  }

  function editLesson(index: number, patch: Partial<Draft>) {
    touch();
    setLessons((current) =>
      current.map((lesson, at) => (at === index ? { ...lesson, ...patch } : lesson)),
    );
  }

  function addLesson() {
    touch();
    // No id: the server mints one on save, so two tabs cannot collide.
    setLessons((current) => [...current, { title: "", body: "" }]);
  }

  function removeLesson(index: number) {
    touch();
    setLessons((current) => current.filter((_, at) => at !== index));
  }

  async function save() {
    // An empty lesson is someone who pressed Add and changed their mind, not
    // an error worth stopping them for.
    const kept = lessons.filter(
      (lesson) => lesson.title.trim().length > 0 && lesson.body.trim().length > 0,
    );
    const halfWritten = lessons.length - kept.length;

    setSaving(true);
    setError(undefined);
    setNotice(undefined);

    try {
      const response = await fetch("/api/knowledge", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefing, lessons: kept }),
      });
      const payload = await readJson<{
        error?: string;
        knowledge: GeneralKnowledge;
      }>(response);
      if (!response.ok) throw new Error(payload.error ?? "Save failed.");

      setLessons(payload.knowledge.lessons as Lesson[]);
      setUpdatedAt(payload.knowledge.updated_at);
      setNotice(
        halfWritten > 0
          ? `Saved. ${halfWritten} empty ${halfWritten === 1 ? "lesson was" : "lessons were"} dropped.`
          : "Saved. Every interview from now on is told this.",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-10">
      <div className="panel p-4">
        <p className="prose-block text-sm">
          This is handed to the interviewer before any system is discussed, so
          it can follow you instead of asking you to explain the field from the
          beginning. It is <strong>orientation, never authority</strong>: where
          it disagrees with a system&rsquo;s approved profile the profile wins,
          and where it disagrees with you, you win. It is never used to fill a
          gap in what you actually said &mdash; the record a scenario becomes is
          built from your transcript alone.
        </p>
        <p className="mt-3 text-xs text-muted">
          Last edited {new Date(updatedAt).toLocaleString()}
        </p>
      </div>

      {/* ---- The briefing ------------------------------------------- */}
      <section>
        <h2 className="text-sm font-semibold">How air defence works</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          The background any operator would take for granted. Keep what is true
          across systems here, and leave anything that differs between them to
          the questions each system answers for itself &mdash; ranges, how many
          interceptors can be in the air, who authorises. Markdown.
        </p>
        <textarea
          className="field mt-3 min-h-[28rem] font-mono text-xs leading-relaxed"
          value={briefing}
          onChange={(event) => {
            touch();
            setBriefing(event.target.value);
          }}
        />
      </section>

      {/* ---- The lessons -------------------------------------------- */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Lessons that hold across systems
          </h2>
          <span className="text-xs text-muted">
            {lessons.length} {lessons.length === 1 ? "lesson" : "lessons"}
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
          Things worth knowing that are not about one system. The natural time
          to add one is straight after an interview, when something has just
          proved true again.
        </p>

        <div className="mt-4 space-y-4">
          {lessons.map((lesson, index) => (
            <div key={lesson.id ?? `new-${index}`} className="panel p-4">
              <div className="flex flex-wrap items-start gap-3">
                <input
                  className="field data flex-1"
                  placeholder="A short name for the lesson"
                  value={lesson.title}
                  onChange={(event) =>
                    editLesson(index, { title: event.target.value })
                  }
                />
                <button
                  type="button"
                  className="btn text-xs"
                  onClick={() => removeLesson(index)}
                  disabled={saving}
                >
                  Remove
                </button>
              </div>
              <textarea
                className="field mt-3 min-h-28 text-sm"
                placeholder="What the lesson is, in your own words."
                value={lesson.body}
                onChange={(event) =>
                  editLesson(index, { body: event.target.value })
                }
              />
            </div>
          ))}

          {lessons.length === 0 ? (
            <p className="panel p-4 text-sm text-muted">
              No lessons yet. Everything general lives in the briefing above
              until you start adding them.
            </p>
          ) : null}
        </div>

        <button
          type="button"
          className="btn mt-4"
          onClick={addLesson}
          disabled={saving}
        >
          Add a lesson
        </button>
      </section>

      {error ? <p className="chip status-danger !normal-case">{error}</p> : null}
      {notice ? <p className="chip status-ok !normal-case">{notice}</p> : null}

      <div className="sticky bottom-0 border-t border-line bg-bg py-4">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
