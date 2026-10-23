// 합성 데이터 생성기 검사: 항상 같은 데이터가 나오고, 형식이 올바르며, 목록 처리가 끝까지 도는지 확인

import { describe, expect, it } from "vitest";
import { isValidDateString } from "../lib/hr/date";
import { resolveStatus } from "../lib/hr/engine";
import { handleListRequest, type EmployeeListBody } from "../lib/hr/queries";
import { generateSynthetic } from "./helpers/synthetic";

describe("합성 데이터 1,500명", () => {
  const data = generateSynthetic(1500);

  it("직원 1,500명, 사번 중복 없음, 모두 합성 표시", () => {
    expect(data.employees).toHaveLength(1500);
    const ids = data.employees.map((e) => e.id);
    expect(new Set(ids).size).toBe(1500);
    expect(data.employees.every((e) => /^S\d{5}$/.test(e.id) && e.name.startsWith("합성직원"))).toBe(true);
  });

  it("기록 번호 중복 없음, 모든 기록이 존재하는 직원을 가리키고 날짜가 모두 올바름", () => {
    const eventIds = data.events.map((e) => e.id);
    expect(new Set(eventIds).size).toBe(eventIds.length);
    const empIds = new Set(data.employees.map((e) => e.id));
    for (const e of data.events) {
      expect(empIds.has(e.employeeId)).toBe(true);
      expect(isValidDateString(e.effectiveDate)).toBe(true);
      if (e.endDate !== null) expect(isValidDateString(e.endDate)).toBe(true);
    }
  });

  it("같은 씨앗이면 같은 데이터, 다른 씨앗이면 다른 데이터", () => {
    expect(generateSynthetic(1500)).toEqual(data);
    expect(generateSynthetic(1500, 1)).not.toEqual(data);
  });

  it("기록 수는 직원 한 명당 평균 1.5~6건 사이 (여러 해 기록)", () => {
    const perEmployee = data.events.length / data.employees.length;
    expect(perEmployee).toBeGreaterThan(1.5);
    expect(perEmployee).toBeLessThan(6);
  });

  it("목록 처리가 끝까지 돌고 총원 1,500, 상태별 합계가 총원과 일치", () => {
    const r = handleListRequest("2026-10-28", data);
    expect(r.status).toBe(200);
    const body = r.body as EmployeeListBody;
    expect(body.total).toBe(1500);
    expect(Object.values(body.counts).reduce((a, b) => a + b, 0)).toBe(1500);
    // 네 상태가 모두 나타나는 데이터여야 측정이 의미 있음
    expect(Object.values(body.counts).every((c) => c > 0)).toBe(true);
  });

  it("직원별로 나눠 계산한 목록이, 직원마다 전체 기록을 넘기던 이전 방식과 완전히 같음", () => {
    const body = handleListRequest("2026-10-28", data).body as EmployeeListBody;
    const old = body.employees.map((row) => ({
      row,
      r: resolveStatus(row.id, data.events, "2026-10-28"),
    }));
    for (const { row, r } of old) {
      expect([row.status, row.leaveType, row.dept, row.warnings]).toEqual([
        r.status,
        r.leaveType,
        r.dept,
        r.warnings,
      ]);
    }
    // 다른 기준일에서도 같은지 한 번 더 확인
    const body2 = handleListRequest("2019-06-15", data).body as EmployeeListBody;
    for (const row of body2.employees) {
      const r = resolveStatus(row.id, data.events, "2019-06-15");
      expect([row.status, row.leaveType, row.dept, row.warnings]).toEqual([
        r.status,
        r.leaveType,
        r.dept,
        r.warnings,
      ]);
    }
  });

  it("목록 결과도 같은 입력이면 항상 같음", () => {
    expect(handleListRequest("2026-10-28", data)).toEqual(handleListRequest("2026-10-28", data));
  });
});
