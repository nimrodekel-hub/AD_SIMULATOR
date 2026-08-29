"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DilemmaForm } from "@/components/dilemma-form";
import type { DilemmaDraft } from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";

/**
 * Screen 1a — the designer teaches the system a dilemma.
 *
 * Two phases in one screen. First a conversation, which is where the expertise
 * actually comes out. Then a structured record extracted from that conversation
 * and shown as an editable form, because the brief is explicit that the agent
 * must hand back something reviewable rather than say "got it, thanks".
 */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Names the system, so the designer answers about that one and not in general. */
const openingMessage = (systemName: string): ChatMessage => ({
  role: "assistant",
  content: `Let's capture one dilemma an operator of ${systemName} faces. Start anywhere — the situation that makes them hesitate, a decision you have seen go wrong, or the trade-off you most want trainees to feel.\n\nI'll ask follow-up questions as we go, and when there's enough to work with I'll say so.`,
});

export function LearningChat({
  systemId,
  systemName,
}: {
  /** The system this dilemma is being taught inside. It is filed under it. */
  systemId: string;
  systemName: string;
}) {
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    openingMessage(systemName),
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const [draft, setDraft] = useState<DilemmaDraft | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const scrollAnchor = useRef<HTMLDivElement>(null);

  /* Follow the conversation as it grows, including during streaming. */
  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  const transcript = () =>
    messages
      .map((m) => `${m.role === "user" ? "EXPERT" : "INTERVIEWER"}: ${m.content}`)
      .join("\n\n");

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    const history = [...messages, { role: "user" as const, content: text }];
    setMessages(history);
    setInput("");
    setStreaming(true);
    setError(undefined);

    try {
      const response = await fetch("/api/designer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The opening message is scene-setting written by this component, not
        // something the model said, so it is not part of the history it sees.
        body: JSON.stringify({ messages: history.slice(1) }),
      });

      if (!response.ok || !response.body) {
        // A streamed route still answers with JSON when it refuses, but a
        // platform-level failure answers with neither.
        const detail = await readJson<{ error?: string }>(response).catch(
          (reason: Error) => ({ error: reason.message }),
        );
        throw new Error(detail.error ?? `Request failed (${response.status})`);
      }

      // Open an empty assistant turn, then fill it as chunks arrive.
      setMessages([...history, { role: "assistant", content: "" }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assembled = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        assembled += decoder.decode(value, { stream: true });
        setMessages([...history, { role: "assistant", content: assembled }]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Something went wrong.");
      setMessages(history);
    } finally {
      setStreaming(false);
    }
  }

  async function extract() {
    setExtracting(true);
    setError(undefined);
    try {
      const response = await fetch("/api/designer/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcript() }),
      });
      const payload = await readJson<{ error?: string; draft: DilemmaDraft }>(
        response,
      );
      if (!response.ok) throw new Error(payload.error ?? "Extraction failed.");
      setDraft(payload.draft as DilemmaDraft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  }

  async function save(edited: DilemmaDraft) {
    setSaving(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/systems/${systemId}/dilemmas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: edited, transcript: transcript() }),
      });
      const payload = await readJson<{ error?: string; entry: { id: string } }>(
        response,
      );
      if (!response.ok) throw new Error(payload.error ?? "Save failed.");
      router.push(
        `/designer/systems/${systemId}/dilemmas/${payload.entry.id}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed.");
      setSaving(false);
    }
  }

  /* ---- Phase 2: review the extracted record ---------------------- */
  if (draft) {
    return (
      <div>
        <div className="panel mb-6 p-4">
          <p className="text-sm">
            Extracted from the conversation. Nothing is published yet — review
            every field, correct what the interview got wrong, then save it as a
            draft.
          </p>
        </div>

        <DilemmaForm
          initial={draft}
          saving={saving}
          error={error}
          primaryLabel="Save as draft"
          onSubmit={save}
          secondary={
            <button
              type="button"
              className="btn"
              onClick={() => setDraft(null)}
              disabled={saving}
            >
              Back to conversation
            </button>
          }
        />
      </div>
    );
  }

  /* ---- Phase 1: the interview ------------------------------------ */
  const canExtract = messages.length > 2 && !streaming && !extracting;

  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex-1 space-y-5">
        {messages.map((message, index) => (
          <Bubble key={index} role={message.role} content={message.content} />
        ))}
        {streaming && messages.at(-1)?.content === "" ? (
          <p className="text-sm text-muted">Thinking…</p>
        ) : null}
        <div ref={scrollAnchor} />
      </div>

      {error ? (
        <p className="chip status-danger mt-4 !normal-case">{error}</p>
      ) : null}

      <div className="sticky bottom-0 mt-6 border-t border-line bg-bg pt-4">
        <textarea
          className="field min-h-24 resize-y"
          placeholder="Describe the dilemma in your own words…"
          value={input}
          disabled={streaming}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. Experts type paragraphs
            // here, so the newline case has to stay easy.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void send()}
            disabled={streaming || input.trim().length === 0}
          >
            {streaming ? "Responding…" : "Send"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void extract()}
            disabled={!canExtract}
          >
            {extracting ? "Extracting…" : "Extract structured entry"}
          </button>
          <span className="text-xs text-muted">
            Shift+Enter for a new line.
          </span>
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, content }: ChatMessage) {
  const isUser = role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div
        className={`panel prose-block max-w-[46rem] whitespace-pre-wrap px-4 py-3 text-sm ${
          isUser ? "border-accent/40 bg-panel-raised" : ""
        }`}
      >
        <p className="mb-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted">
          {isUser ? "You" : "Knowledge agent"}
        </p>
        {content}
      </div>
    </div>
  );
}
