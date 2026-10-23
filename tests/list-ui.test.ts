// 목록 화면에 쓰는 로직 테스트: 한국 시간 오늘 날짜, 부서·상태 필터

import { describe, expect, it } from "vitest";
import { applyFilter, firstValue, listDepts, parseFilter } from "../lib/hr/filter";
import { handleListRequest, type EmployeeListBody } from "../lib/hr/queries";
import { koreaToday } from "../lib/hr/today";

describe("한국 시간 기준 오늘 날짜", () => {
  it("세계 표준시 15:00 전까지는 같은 날 (한국 23:59)", () => {
    expect(koreaToday(new Date("2026-10-28T14:59:59Z"))).toBe("2026-10-28");
  });

  it("세계 표준시 15:00 부터는 한국의 다음 날 0시", () => {
    expect(koreaToday(new Date("2026-10-28T15:00:00Z"))).toBe("2026-10-29");
  });

  it("한국 새벽 0~9시에도 하루 전 날짜가 나오지 않음", () => {
    expect(koreaToday(new Date("2026-10-27T15:30:00Z"))).toBe("2026-10-28");
    expect(koreaToday(new Date("2026-10-28T00:30:00Z"))).toBe("2026-10-28");
  });

  it("연말과 윤년 경계", () => {
    expect(koreaToday(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(koreaToday(new Date("2028-02-28T15:00:00Z"))).toBe("2028-02-29");
  });

  it("결과는 항상 YYYY-MM-DD 형식", () => {
    expect(koreaToday(new Date("2026-01-05T00:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("부서·상태 필터", () => {
  const body = handleListRequest("2026-10-28").body as EmployeeListBody;
  const depts = listDepts(body.employees);

  it("부서 목록은 중복 없이 가나다순", () => {
    expect(depts).toEqual(["수술실", "병동A", "병동B", "응급실", "외래", "중환자실"].sort((a, b) => a.localeCompare(b, "ko")));
    expect(new Set(depts).size).toBe(depts.length);
  });

  it("필터가 없으면 전체", () => {
    const filter = parseFilter(undefined, undefined, depts);
    expect(filter).toEqual({ dept: null, status: null, warnOnly: false });
    expect(applyFilter(body.employees, filter)).toHaveLength(30);
  });

  it("상태 필터: 휴직은 집계의 휴직 인원(7명)과 같음", () => {
    const rows = applyFilter(body.employees, parseFilter(undefined, "휴직", depts));
    expect(rows).toHaveLength(body.counts["휴직"]);
    expect(rows.every((r) => r.status === "휴직")).toBe(true);
  });

  it("부서와 상태를 함께 걸면 두 조건을 모두 만족", () => {
    const rows = applyFilter(body.employees, parseFilter("외래", "현원", depts));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.dept === "외래" && r.status === "현원")).toBe(true);
  });

  it("목록에 없는 부서나 모르는 상태는 전체로 취급 (주소의 값을 믿지 않음)", () => {
    expect(parseFilter("존재하지않는부서", "아무상태", depts)).toEqual({ dept: null, status: null, warnOnly: false });
    expect(parseFilter("<script>", "' OR 1=1", depts)).toEqual({ dept: null, status: null, warnOnly: false });
  });

  it("경고 필터: 값이 정확히 \"1\"일 때만 켜지고, 경고 있는 직원 4명(3·9·11·14번)만 남김", () => {
    expect(parseFilter(undefined, undefined, depts, "1").warnOnly).toBe(true);
    for (const bad of [undefined, "", "0", "true", "yes", "11"]) {
      expect(parseFilter(undefined, undefined, depts, bad).warnOnly).toBe(false);
    }
    const rows = applyFilter(body.employees, parseFilter(undefined, undefined, depts, "1"));
    expect(rows.map((r) => r.name)).toEqual([
      "가명직원03",
      "가명직원09",
      "가명직원11",
      "가명직원14",
    ]);
    expect(rows.length).toBe(body.warningCount);
  });

  it("경고 필터와 상태 필터를 함께 걸면 둘 다 만족", () => {
    const rows = applyFilter(body.employees, parseFilter(undefined, "휴직", depts, "1"));
    expect(rows.map((r) => r.name)).toEqual(["가명직원11"]);
  });

  it("주소 값이 여러 개(배열)면 첫 번째만 사용", () => {
    expect(firstValue(["외래", "병동A"])).toBe("외래");
    expect(firstValue("외래")).toBe("외래");
    expect(firstValue(undefined)).toBeUndefined();
  });

  it("필터를 걸어도 원본 목록은 바뀌지 않음", () => {
    const before = JSON.stringify(body.employees);
    applyFilter(body.employees, parseFilter("외래", "휴직", depts));
    expect(JSON.stringify(body.employees)).toBe(before);
  });
});
