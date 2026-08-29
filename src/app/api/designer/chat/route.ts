import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { designerChatStream } from "@/lib/ai/tasks/learn-dilemma";
import {
  asPromptSection,
  getGeneralKnowledge,
} from "@/lib/store/general-knowledge";
import { getSystem, getSystemProfile } from "@/lib/store/kb";

/**
 * The designer's learning conversation.
 *
 * A Route Handler rather than a Server Action: actions are dispatched one at a
 * time per client and return a single serialised value, neither of which suits
 * a streamed reply.
 */

/**
 * Every route that calls the model gets the long ceiling.
 *
 * A model call is the only thing here that takes minutes, and the platform
 * kills the function when this elapses. Raising the ceiling is not the same as
 * surviving a slow step, though: past about a minute it is the browser that
 * gives up, not the server. Measured against production this route stays well
 * inside that, so it answers in the request. The three that do not — extracting
 * a dilemma, generating a scenario and building a console — hand back a job
 * record instead and let the page ask how it is getting on. See
 * `lib/store/job.ts`.
 */
export const maxDuration = 300;

const BodySchema = z.object({
  /**
   * Which system this dilemma is being taught inside.
   *
   * The interviewer is given that system's approved profile, so it does not
   * spend the expert's turns asking for identification states and readouts
   * they have already written down and approved.
   */
  system_id: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    // Validate before streaming starts: once the first chunk is out, the status
    // code has already been sent and cannot be changed.
    return NextResponse.json(
      { error: "Invalid request body", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const [system, profile, general] = await Promise.all([
    getSystem(parsed.data.system_id),
    getSystemProfile(parsed.data.system_id),
    getGeneralKnowledge(),
  ]);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  return new Response(
    designerChatStream(parsed.data.messages, {
      name: system.name,
      // Only an approved profile is fact. A draft is the designer still
      // working, and half-taught behaviour is worse than none.
      profile: profile?.approved ? profile : null,
    },
    asPromptSection(general)),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        // Stops intermediate proxies from holding the response until it completes.
        "X-Accel-Buffering": "no",
      },
    },
  );
}
