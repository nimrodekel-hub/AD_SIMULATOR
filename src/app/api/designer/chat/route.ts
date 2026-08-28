import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { designerChatStream } from "@/lib/ai/tasks/learn-dilemma";

/**
 * The designer's learning conversation.
 *
 * A Route Handler rather than a Server Action: actions are dispatched one at a
 * time per client and return a single serialised value, neither of which suits
 * a streamed reply.
 */

export const maxDuration = 60;

const BodySchema = z.object({
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

  return new Response(designerChatStream(parsed.data.messages), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // Stops intermediate proxies from holding the response until it completes.
      "X-Accel-Buffering": "no",
    },
  });
}
