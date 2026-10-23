// 직원 목록·집계 조회 API (읽기 전용)
import type { NextRequest } from "next/server";
import { handleListRequest } from "@/lib/hr/queries";

export function GET(request: NextRequest) {
  const { status, body } = handleListRequest(request.nextUrl.searchParams.get("asOf"));
  // 인사 정보이므로 브라우저나 중간 서버가 응답을 저장하지 않게 합니다.
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
