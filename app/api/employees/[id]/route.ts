// 직원 한 명의 상태와 근거 타임라인 조회 API (읽기 전용)
import type { NextRequest } from "next/server";
import { handleDetailRequest } from "@/lib/hr/queries";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { status, body } = handleDetailRequest(id, request.nextUrl.searchParams.get("asOf"));
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
