import { NextResponse } from "next/server";
import type { ApiResponse } from "@/lib/contract";
import { dispatchAction } from "@/server/actions";
import { describeError } from "@/server/git/errors";
import { assertLocalRequest, readJsonBody } from "@/server/http/guard";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    const body = await readJsonBody(request);
    const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const data = await dispatchAction({ action: payload.action, repoId: payload.repoId, params: payload.params });
    return NextResponse.json({ ok: true, data } satisfies ApiResponse<unknown>);
  } catch (error) {
    const { status, ...payload } = describeError(error);
    return NextResponse.json({ ok: false, error: payload } satisfies ApiResponse<never>, { status });
  }
}
