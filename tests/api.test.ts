// 조회 API 처리 로직 테스트: 기준일 검사(400), 없는 사번(404), 정상 응답(200)

import { describe, expect, it } from "vitest";
import { handleDetailRequest, handleListRequest } from "../lib/hr/queries";

const AS_OF = "2026-10-28";

interface ErrorBody {
  error: { code: string; message: string };
}
interface ListBody {
  asOf: string;
  notice: string;
  total: number;
  counts: Record<string, number>;
  warningCount: number;
  employees: {
    id: string;
    name: string;
    dept: string | null;
    status: string;
    warnings: string[];
  }[];
}
interface DetailBody {
  asOf: string;
  employee: { id: string; name: string };
  status: string;
  leaveType: string | null;
  dept: string | null;
  warnings: string[];
  timeline: {
    id: string;
    applied: boolean;
    isEvidence: boolean;
    hasWarning: boolean;
    kindLabel: string;
  }[];
}

describe("목록 API: 기준일 검사", () => {
  const BAD = [
    null, // 기준일 없음
    "",
    "2026-1-5",
    "20261028",
    "2026-02-30",
    "2026-13-01",
    "2026/10/28",
    " 2026-10-28",
    "2026-10-28; DROP TABLE",
    "<script>alert(1)</script>",
    "9".repeat(5000),
  ];

  for (const value of BAD) {
    it(`기준일 ${JSON.stringify(value)?.slice(0, 40)} 는 400`, () => {
      const r = handleListRequest(value);
      expect(r.status).toBe(400);
      expect((r.body as ErrorBody).error.code).toBe("INVALID_AS_OF");
    });
  }

  it("오류 메시지에 입력값을 되돌려 적지 않음", () => {
    const evil = "<script>alert(1)</script>";
    const r = handleListRequest(evil);
    expect(JSON.stringify(r.body)).not.toContain("script");
    expect(JSON.stringify(r.body)).not.toContain(evil);
  });
});

describe("목록 API: 정상 응답", () => {
  const r = handleListRequest(AS_OF);
  const body = r.body as ListBody;

  it("200과 가명 안내 문구", () => {
    expect(r.status).toBe(200);
    expect(body.asOf).toBe(AS_OF);
    expect(body.notice).toContain("가명");
  });

  it("총원 30, 상태별 인원은 현원 19·휴직 7·퇴직 3·입사예정 1, 합계가 총원과 일치", () => {
    expect(body.total).toBe(30);
    expect(body.counts).toEqual({ 현원: 19, 휴직: 7, 퇴직: 3, 입사예정: 1 });
    const sum = Object.values(body.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(body.total);
  });

  it("경고 있는 직원 수(warningCount)는 4명이고 행별 경고와 일치", () => {
    expect(body.warningCount).toBe(4);
    expect(body.warningCount).toBe(body.employees.filter((e) => e.warnings.length > 0).length);
  });

  it("한 사번은 한 줄에만 나오고 사번순으로 정렬", () => {
    const ids = body.employees.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  it("기준일을 바꾸면 결과가 바뀜 (10/27의 휴직은 1·2·4·7·11·12번 6명)", () => {
    // 6번(이동+휴직)과 15번(하루짜리 휴직)은 10/28부터라 아직 현원입니다.
    const other = handleListRequest("2026-10-27").body as ListBody;
    expect(other.counts["휴직"]).toBe(6);
    expect(other.total).toBe(30);
  });

  it("같은 요청을 2회 하면 결과가 같음", () => {
    expect(handleListRequest(AS_OF)).toEqual(r);
  });
});

describe("상세 API", () => {
  it("정상 사번은 200, 상태와 근거 타임라인", () => {
    const r = handleDetailRequest("T00101", AS_OF);
    const body = r.body as DetailBody;
    expect(r.status).toBe(200);
    expect(body.employee).toEqual({ id: "T00101", name: "가명직원01" });
    expect([body.status, body.leaveType, body.dept]).toEqual(["휴직", "육아휴직", "병동A"]);
    expect(body.timeline.map((t) => t.kindLabel)).toEqual([
      "입사",
      "휴직·휴가 시작",
      "휴직·휴가 시작",
    ]);
    expect(body.timeline.every((t) => t.applied)).toBe(true);
    // 상태 판정의 근거는 입사(부서)와 지금 적용 중인 육아휴직
    expect(body.timeline.filter((t) => t.isEvidence)).toHaveLength(2);
  });

  it("미래 기록은 applied=false 로 표시", () => {
    const body = handleDetailRequest("T00105", AS_OF).body as DetailBody;
    const future = body.timeline.filter((t) => !t.applied);
    expect(future).toHaveLength(2);
    expect(body.status).toBe("현원");
  });

  it("경고가 있는 직원은 경고를 함께 돌려줌", () => {
    const body = handleDetailRequest("T00103", AS_OF).body as DetailBody;
    expect(body.warnings).toHaveLength(1);
  });

  const MISSING = ["T99999", "101", "t00101", "T00101 ", "", "../etc/passwd", "T00101/../T00102"];
  for (const id of MISSING) {
    it(`없는 사번 ${JSON.stringify(id)} 는 404`, () => {
      const r = handleDetailRequest(id, AS_OF);
      expect(r.status).toBe(404);
      expect((r.body as ErrorBody).error.code).toBe("EMPLOYEE_NOT_FOUND");
      expect(JSON.stringify(r.body)).not.toContain("passwd");
    });
  }

  it("기준일 검사가 사번 검사보다 먼저: 잘못된 기준일 + 없는 사번은 400", () => {
    expect(handleDetailRequest("T99999", "2026-1-5").status).toBe(400);
    expect(handleDetailRequest("T99999", null).status).toBe(400);
  });
});
