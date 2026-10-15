import { z } from "zod";
import { db } from "@/db";
import { ActionSchema, handle } from "@/engine/actions";
import { checkKey, errorResponse } from "@/engine/http";
import { loadState } from "@/engine/state";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    checkKey(req);
    const parsed = ActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return Response.json(
        { error: z.prettifyError(parsed.error) },
        { status: 400 },
      );
    const d = await db();
    const { notice } = await handle(d, parsed.data);
    return Response.json({
      ...(await loadState(d)),
      ...(notice ? { notice } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
