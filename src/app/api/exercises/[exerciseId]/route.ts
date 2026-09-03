import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { RevisionSchema, ExerciseInstanceSchema } from "@/lib/domain/schemas";
import { getSavedExercise, saveExercise } from "@/lib/store/exercises";

/** One exercise in the library: read it, or accept a correction to it. */

const AcceptSchema = z.object({
  system_id: z.string().min(1),
  exercise_instance: ExerciseInstanceSchema,
  revisions: z.array(RevisionSchema).default([]),
});

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/exercises/[exerciseId]">,
) {
  const { exerciseId } = await ctx.params;
  const systemId = new URL(_request.url).searchParams.get("system") ?? "";
  return NextResponse.json({
    exercise: systemId ? await getSavedExercise(systemId, exerciseId) : null,
  });
}

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/exercises/[exerciseId]">,
) {
  const { exerciseId } = await ctx.params;
  const parsed = AcceptSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid exercise" }, { status: 400 });
  }

  const existing = await getSavedExercise(parsed.data.system_id, exerciseId);
  if (!existing) {
    return NextResponse.json({ error: "Exercise not found" }, { status: 404 });
  }

  const updated = {
    ...existing,
    exercise_instance: parsed.data.exercise_instance,
    revisions: parsed.data.revisions,
    updated_at: new Date().toISOString(),
  };

  try {
    await saveExercise(updated, `Accept correction to ${exerciseId.slice(0, 8)}`);
    return NextResponse.json({ exercise: updated });
  } catch (reason) {
    return NextResponse.json(
      { error: reason instanceof Error ? reason.message : "Failed to save." },
      { status: 500 },
    );
  }
}
