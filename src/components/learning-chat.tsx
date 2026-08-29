"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DilemmaForm } from "@/components/dilemma-form";
import type { DilemmaDraft } from "@/lib/domain/schemas";
import { readJson } from "@/lib/http";
import { type JobView, formatWait, useBackgroundJob } from "@/lib/use-job";

/**
 * Screen 1a — the designer teaches the system a dilemma.
 *
 * Two phases in one screen. First a conversation, which is where the expertise
 * actually comes out. Then a structured record extracted from that conversation
 * and shown as an editable form, because the brief is explicit that the agent
 * must hand back something reviewable rather than say "got it, thanks".
 *
 * The extraction between the two phases is the slow part — reading a whole
 * interview takes a minute and a half or more, which is longer than a phone
 * will hold a connection open. So it does not hold one: the press starts the
 * work on the server and this screen asks every few seconds whether it has
 * finished. The transcript comes back with the draft, so returning to this page
 * after the conversation itself is gone still gives you something to save.
 */

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** What the extraction hands back once it finishes. */
interface ExtractionResult {
  draft: DilemmaDraft;
  transcript: string;
}

/** Names the system, so the designer answers about that one and not in general. */
const openingMessage = (systemName: string): ChatMessage => ({
  role: "assistant",
  content: `Let's capture one dilemma an operator of ${systemName} faces. Start anywhere — the situation that makes them hesitate, a decision you have seen go wrong, or the trade-off you most want trainees to feel.\n\nI'll ask follow-up questions as we go, and when there's enough to work with I'll say so.`,
});

export function LearningChat({
  systemId,
  systemName,
  initialJob,
}: {
  /** The system this dilemma is being taught inside. It is filed under it. */
  systemId: string;
  systemName: string;
  /** Whatever extraction was under way, or finished, when this page loaded. */
  initialJob: JobView<ExtractionResult>;
}) {
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    openingMessage(systemName),
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const [draft, setDraft] = useState<DilemmaDraft | null>(
    initialJob.result?.draft ?? null,
  );
  /**
   * The conversation the draft came from, as it will be filed.
   *
   * Taken from the extraction rather than rebuilt from the messages on screen,
   * because a page reopened after a locked phone has a draft and no messages.
   */
  const [extractedFrom, setExtractedFrom] = useState(
    initialJob.result?.transcript ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [chatError, setChatError] = useState<string>();

  const scrollAnchor = useRef<HTMLDivElement>(null);

  /* Follow the conversation as it grows, including during streaming. */
  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  const transcript = () =>
    messages
      .map((m) => `${m.role === "user" ? "EXPERT" : "INTERVIEWER"}: ${m.content}`)
      .join("\n\n");

  const {
    running: extracting,
    waited,
    error: extractError,
    setError: setExtractError,
    start: startExtraction,
  } = useBackgroundJob<ExtractionResult>({
    startUrl: `/api/systems/${systemId}/dilemmas/extract`,
    initial: initialJob,
    onDone: (result) => {
      setDraft(result.draft);
      setExtractedFrom(result.transcript);
    },
  });

  /** Whichever thing went wrong most recently. Only one is ever on screen. */
  const error = chatError ?? extractError;

  /**
   * Sends one turn and streams the reply back.
   *
   * A phone drops connections — a locked screen, a switch from wifi to
   * cellular, a tunnel — and this is the screen where losing one costs the
   * most, because the conversation lives nowhere but here. So a broken stream
   * is not treated as a failed turn:
   *
   *   - whatever arrived is kept, marked as cut off, rather than deleted;
   *   - the question is retried once by itself, since most drops are transient;
   *   - a retry re-sends the same turn instead of appending a second copy of
   *     it, which is what left two identical questions on screen before.
   */
  async function send(retry?: { text: string; history: ChatMessage[] }) {
    const text = (retry?.text ?? input).trim();
    if (!text || streaming) return;

    // The retry carries the conversation with it rather than reading state:
    // this closure still holds the messages from the render that created it,
    // which are the ones from *before* this turn was added.
    const history =
      retry?.history ?? [...messages, { role: "user" as const, content: text }];

    setMessages(history);
    if (!retry) setInput("");
    setStreaming(true);
    setChatError(undefined);

    let assembled = "";

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

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        assembled += decoder.decode(value, { stream: true });
        // Leading spaces are the server's keep-alive, sent while the model is
        // still thinking. They are not part of the reply.
        setMessages([
          ...history,
          { role: "assistant", content: assembled.trimStart() },
        ]);
      }
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Something went wrong.";

      if (assembled.trim().length > 0) {
        // Words did arrive. Losing them would cost the expert real work, so
        // keep them and say plainly that the answer is incomplete.
        setMessages([
          ...history,
          { role: "assistant", content: assembled.trimStart() },
        ]);
        setChatError(
          "The connection dropped part-way through the answer. What arrived is kept above — send anything to carry on.",
        );
      } else if (!retry) {
        // Nothing arrived and this was the first attempt. Most drops on a
        // phone are transient, so try the same turn once more by itself.
        setStreaming(false);
        await send({ text, history });
        return;
      } else {
        // The retry failed too. Hand the question back rather than stranding
        // it in the conversation with no answer.
        setMessages(history.slice(0, -1));
        setInput(text);
        setChatError(`${message} Your question is back in the box — nothing was lost.`);
      }
    } finally {
      setStreaming(false);
    }
  }

  function extract() {
    setChatError(undefined);
    return startExtraction({ transcript: transcript() });
  }

  /**
   * Puts the conversation back in charge.
   *
   * The stored extraction is dropped too, so that coming back to this screen
   * later does not present a draft the designer has already turned down.
   */
  async function discardDraft() {
    setDraft(null);
    setExtractedFrom("");
    setExtractError(undefined);
    await fetch(`/api/systems/${systemId}/dilemmas/extract`, {
      method: "DELETE",
    }).catch(() => {
      // Worth trying, not worth blocking on: the record is overwritten by the
      // next extraction anyway.
    });
  }

  async function save(edited: DilemmaDraft) {
    setSaving(true);
    setChatError(undefined);
    try {
      const response = await fetch(`/api/systems/${systemId}/dilemmas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: edited,
          // What the draft was actually extracted from, which after a reload is
          // no longer what is on screen.
          transcript: extractedFrom || transcript(),
        }),
      });
      const payload = await readJson<{ error?: string; entry: { id: string } }>(
        response,
      );
      if (!response.ok) throw new Error(payload.error ?? "Save failed.");

      // Saved: the extraction has been reviewed and is no longer pending.
      await fetch(`/api/systems/${systemId}/dilemmas/extract`, {
        method: "DELETE",
      }).catch(() => undefined);

      router.push(
        `/designer/systems/${systemId}/dilemmas/${payload.entry.id}`,
      );
    } catch (reason) {
      setChatError(reason instanceof Error ? reason.message : "Save failed.");
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
              onClick={() => void discardDraft()}
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

      {extracting ? (
        <div className="panel mt-6 p-4">
          <p className="text-sm">
            Reading the conversation
            {waited > 0 ? ` — ${formatWait(waited)} so far` : "…"}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            A minute or two is normal. It is running on the server, so you can
            lock your phone, switch tabs or close this page — the extracted
            record will be waiting here when you come back.
          </p>
        </div>
      ) : null}

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
