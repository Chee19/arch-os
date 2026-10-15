import { connection } from "next/server";
import { db } from "@/db";
import { errorResponse } from "@/engine/http";
import { loadState } from "@/engine/state";

export async function GET() {
  // Outside the try so the prerender bail-out signal is never swallowed.
  await connection();
  try {
    return Response.json(await loadState(await db()));
  } catch (e) {
    return errorResponse(e);
  }
}
