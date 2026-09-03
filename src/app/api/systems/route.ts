import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createSystem, listSystems } from "@/lib/store/kb";

/**
 * The collection of simulated systems.
 *
 * A system exists as soon as it is named. The behaviour profile, the console
 * and the scenarios are filled in afterwards, each on its own screen, so a
 * designer can start a second system without finishing the first.
 */

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  note: z.string().trim().max(200).default(""),
});

export async function GET() {
  return NextResponse.json({ systems: await listSystems() });
}

export async function POST(request: NextRequest) {
  const parsed = CreateSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Give the system a name (up to 80 characters)." },
      { status: 400 },
    );
  }

  // The name is the fictional one shown on the console and used in every
  // prompt, so a duplicate would make two systems indistinguishable in a
  // trainee's list. Cheap to check, confusing to discover later.
  const existing = await listSystems();
  if (
    existing.some(
      (system) =>
        system.name.toLowerCase() === parsed.data.name.toLowerCase(),
    )
  ) {
    return NextResponse.json(
      { error: `There is already a system called "${parsed.data.name}".` },
      { status: 409 },
    );
  }

  try {
    const system = await createSystem(parsed.data.name, parsed.data.note);
    return NextResponse.json({ system }, { status: 201 });
  } catch (reason) {
    return NextResponse.json(
      {
        error:
          reason instanceof Error ? reason.message : "Failed to create the system.",
      },
      { status: 500 },
    );
  }
}
