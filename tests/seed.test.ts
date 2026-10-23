// 가명 시드 데이터(data/seed-employees.json) 검사: 구조가 올바른지, 엔진이 기대대로 판정하는지 확인합니다.

import { describe, expect, it } from "vitest";
import seed from "../data/seed-employees.json";
import { isValidDateString } from "../lib/hr/date";
import { resolveStatus } from "../lib/hr/engine";
import type { Employee, HrEvent } from "../lib/hr/types";

const employees = seed.employees as Employee[];
const events = seed.events as HrEvent[];
const AS_OF = "2026-10-28";

const KINDS = ["hire", "transfer", "leave_start", "return", "termination"];
const SOURCES = ["actual", "auto"];

const resolveAll = (asOf: string) =>
  new Map(
    employees.map((e) => [
      e.id,
      resolveStatus(e.id, events.filter((ev) => ev.employeeId === e.id), asOf),
    ]),
  );

describe("시드 데이터 구조", () => {
  it("가명 안내 문구가 있고 직원은 30명", () => {
    expect(seed.notice).toContain("가명");
    expect(employees).toHaveLength(30);
  });

  it("사번은 문자열이고 중복이 없으며 앞자리 0이 유지됨", () => {
    const ids = employees.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(typeof id).toBe("string");
      expect(id).toMatch(/^T\d{5}$/);
    }
    expect(ids).toContain("T00101");
  });

  it("기록 고유번호는 중복이 없고, 모든 기록이 존재하는 직원을 가리킴", () => {
    const eventIds = events.map((e) => e.id);
    expect(new Set(eventIds).size).toBe(eventIds.length);
    const empIds = new Set(employees.map((e) => e.id));
    for (const e of events) expect(empIds.has(e.employeeId)).toBe(true);
  });

  it("종류·출처 값과 날짜 형식이 올바름", () => {
    for (const e of events) {
      expect(KINDS).toContain(e.kind);
      expect(SOURCES).toContain(e.source);
      expect(isValidDateString(e.effectiveDate)).toBe(true);
      expect(isValidDateString(e.recordedAt)).toBe(true);
      if (e.endDate !== null) expect(isValidDateString(e.endDate)).toBe(true);
    }
  });

  it("직원 이름은 모두 가명 표시를 가짐", () => {
    for (const e of employees) expect(e.name).toMatch(/^가명직원\d{2}$/);
  });
});

describe(`시드 데이터 판정 (기준일 ${AS_OF})`, () => {
  const all = resolveAll(AS_OF);
  const at = (n: number) => all.get(`T${String(100 + n).padStart(5, "0")}`)!;

  it("상태별 인원: 현원 19, 휴직 7, 퇴직 3, 입사예정 1 (합계 30, 중복 없음)", () => {
    const counts = { 현원: 0, 휴직: 0, 퇴직: 0, 입사예정: 0 };
    for (const r of all.values()) counts[r.status] += 1;
    expect(counts).toEqual({ 현원: 19, 휴직: 7, 퇴직: 3, 입사예정: 1 });
    expect(all.size).toBe(30);
  });

  it("시나리오 직원의 판정", () => {
    expect([at(1).status, at(1).leaveType, at(1).dept]).toEqual(["휴직", "육아휴직", "병동A"]);
    expect([at(2).status, at(2).leaveType]).toEqual(["휴직", "육아휴직"]);
    expect([at(3).status, at(3).dept]).toEqual(["현원", "중환자실"]);
    expect([at(4).status, at(4).leaveType]).toEqual(["휴직", "육아휴직"]);
    expect([at(5).status, at(5).dept]).toEqual(["현원", "외래"]);
    expect([at(6).status, at(6).dept]).toEqual(["휴직", "수술실"]);
    expect([at(7).status, at(7).leaveType]).toEqual(["휴직", "병가"]);
    expect(at(8).status).toBe("퇴직");
    expect(at(9).status).toBe("퇴직");
    expect([at(10).status, at(10).dept]).toEqual(["입사예정", "응급실"]);
    expect([at(11).status, at(11).leaveType]).toEqual(["휴직", "육아휴직"]);
    expect(at(12).status).toBe("현원");
    expect(at(13).status).toBe("퇴직");
    expect([at(14).status, at(14).dept]).toEqual(["현원", "병동B"]);
    expect([at(15).status, at(15).leaveType]).toEqual(["휴직", "병가"]);
  });

  it("경고가 나는 직원은 3, 9, 11, 14번뿐", () => {
    const warned = employees
      .filter((e) => all.get(e.id)!.warnings.length > 0)
      .map((e) => e.name);
    expect(warned).toEqual(["가명직원03", "가명직원09", "가명직원11", "가명직원14"]);
  });

  it("같은 입력을 다시 계산하면 결과가 같음", () => {
    expect(resolveAll(AS_OF)).toEqual(all);
  });
});

describe("시드 데이터의 기준일 변경", () => {
  it("10/27에는 1번이 출산휴가, 4번이 병가, 12번이 휴직", () => {
    const all = resolveAll("2026-10-27");
    const at = (n: number) => all.get(`T${String(100 + n).padStart(5, "0")}`)!;
    expect([at(1).status, at(1).leaveType]).toEqual(["휴직", "출산휴가"]);
    expect([at(4).status, at(4).leaveType]).toEqual(["휴직", "병가"]);
    expect(at(12).status).toBe("휴직");
  });

  it("10/27에도 총원은 30명으로 일치", () => {
    expect(resolveAll("2026-10-27").size).toBe(30);
  });
});
