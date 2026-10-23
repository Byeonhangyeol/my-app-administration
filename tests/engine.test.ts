// 인사상태 엔진 시나리오 테스트 (DESIGN.md 5번의 14개 시나리오 + 추가 예외 확인)
// 사번과 이름은 모두 가명입니다.

import { describe, expect, it } from "vitest";
import { resolveStatus } from "../lib/hr/engine";
import type { HrEvent } from "../lib/hr/types";

const EMP = "T00101";
let seq = 0;

/** 테스트용 기록을 만듭니다. 고유번호는 자동으로 붙입니다. */
function ev(
  kind: HrEvent["kind"],
  effectiveDate: string,
  o: Partial<HrEvent> = {},
): HrEvent {
  seq += 1;
  return {
    id: `E${String(seq).padStart(3, "0")}`,
    employeeId: EMP,
    kind,
    effectiveDate,
    endDate: null,
    dept: kind === "hire" || kind === "transfer" ? "중환자실" : null,
    leaveType: null,
    source: "actual",
    recordedAt: "2026-10-23",
    ...o,
  };
}

const run = (events: HrEvent[], asOf: string) => resolveStatus(EMP, events, asOf);
const brief = (events: HrEvent[], asOf: string) => {
  const r = run(events, asOf);
  return [r.status, r.leaveType, r.dept];
};
const hire = () => ev("hire", "2024-03-01", { dept: "외래" });

describe("인사상태 엔진 — 시나리오 14개", () => {
  it("1. 입력 순서를 섞어도 같은 결과", () => {
    const events = [
      hire(),
      ev("leave_start", "2026-07-30", { endDate: "2026-10-27", leaveType: "출산휴가" }),
      ev("leave_start", "2026-10-28", { leaveType: "육아휴직" }),
      ev("transfer", "2025-05-01", { dept: "중환자실" }),
    ];
    const base = run(events, "2026-11-15");
    const orders = [
      [3, 2, 1, 0],
      [1, 0, 3, 2],
      [2, 3, 0, 1],
      [0, 2, 1, 3],
    ];
    for (const order of orders) {
      expect(run(order.map((i) => events[i]), "2026-11-15")).toEqual(base);
    }
  });

  it("2. 산전후휴가(10/27 종료) 다음 날 육아휴직(10/28 시작)이면 계속 휴직", () => {
    const events = [
      hire(),
      ev("leave_start", "2026-07-30", { endDate: "2026-10-27", leaveType: "출산휴가" }),
      ev("leave_start", "2026-10-28", { leaveType: "육아휴직" }),
    ];
    expect(brief(events, "2026-10-27")).toEqual(["휴직", "출산휴가", "외래"]);
    expect(brief(events, "2026-10-28")).toEqual(["휴직", "육아휴직", "외래"]);
    expect(brief(events, "2026-11-15")).toEqual(["휴직", "육아휴직", "외래"]);
    expect(run(events, "2026-11-15").warnings).toEqual([]);
  });

  it("3. 휴직이 여러 번 이어져도 기준일마다 맞게 판정", () => {
    const events = [
      hire(),
      ev("leave_start", "2026-03-01", { endDate: "2026-03-31", leaveType: "병가" }),
      ev("leave_start", "2026-06-01", { endDate: "2026-12-31", leaveType: "육아휴직" }),
    ];
    expect(brief(events, "2026-03-15")).toEqual(["휴직", "병가", "외래"]);
    expect(brief(events, "2026-04-15")).toEqual(["현원", null, "외래"]);
    expect(brief(events, "2026-07-01")).toEqual(["휴직", "육아휴직", "외래"]);
  });

  it("4. 종료일 없는 과거 휴직 뒤에 복직 기록이 있으면 현원 + 과거 미종료 경고", () => {
    const events = [
      hire(),
      ev("leave_start", "2025-01-01", { id: "L1", leaveType: "병가" }),
      ev("return", "2025-06-01", { id: "R1" }),
    ];
    const r = run(events, "2026-10-28");
    expect([r.status, r.leaveType, r.dept]).toEqual(["현원", null, "외래"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("L1");
    expect(brief(events, "2025-03-01")).toEqual(["휴직", "병가", "외래"]);
  });

  it("5. 같은 날 충돌: 사람이 입력한 기록이 자동 생성 기록보다 우선", () => {
    const actualLeaveWins = [
      hire(),
      ev("leave_start", "2026-01-01", { leaveType: "병가" }),
      ev("return", "2026-10-28", { source: "auto" }),
      ev("leave_start", "2026-10-28", { source: "actual", leaveType: "육아휴직" }),
    ];
    expect(brief(actualLeaveWins, "2026-10-28")).toEqual(["휴직", "육아휴직", "외래"]);

    const actualReturnWins = [
      hire(),
      ev("leave_start", "2026-01-01", { leaveType: "병가" }),
      ev("leave_start", "2026-10-28", { source: "auto", leaveType: "자동휴직" }),
      ev("return", "2026-10-28", { source: "actual" }),
    ];
    expect(brief(actualReturnWins, "2026-10-28")).toEqual(["현원", null, "외래"]);
  });

  it("6. 미래 기록은 기준일에 적용하지 않음", () => {
    const events = [
      hire(),
      ev("transfer", "2027-03-01", { dept: "수술실" }),
      ev("leave_start", "2026-12-01", { leaveType: "육아휴직" }),
    ];
    expect(brief(events, "2026-10-28")).toEqual(["현원", null, "외래"]);
  });

  it("7. 시작일과 종료일이 같은 날인 휴직은 그 하루만 휴직", () => {
    const events = [
      hire(),
      ev("leave_start", "2026-10-28", { endDate: "2026-10-28", leaveType: "병가" }),
    ];
    expect(run(events, "2026-10-27").status).toBe("현원");
    expect(run(events, "2026-10-28").status).toBe("휴직");
    expect(run(events, "2026-10-29").status).toBe("현원");
  });

  it("8. 기간이 겹치는 휴직은 나중에 시작한 휴직을 보여주고 경고", () => {
    const events = [
      hire(),
      ev("leave_start", "2026-10-01", { endDate: "2026-10-31", leaveType: "병가" }),
      ev("leave_start", "2026-10-15", { endDate: "2026-12-31", leaveType: "육아휴직" }),
    ];
    const r = run(events, "2026-10-20");
    expect([r.status, r.leaveType]).toEqual(["휴직", "육아휴직"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("겹칩니다");
  });

  it("9. 부서 이동과 휴직이 같은 날이면 새 부서의 휴직", () => {
    const events = [
      hire(),
      ev("transfer", "2026-10-28", { dept: "수술실" }),
      ev("leave_start", "2026-10-28", { leaveType: "육아휴직" }),
    ];
    expect(brief(events, "2026-10-28")).toEqual(["휴직", "육아휴직", "수술실"]);
  });

  it("10. 종료일이 없으면 진행 중(휴직 중)이고 경고 없음", () => {
    const events = [hire(), ev("leave_start", "2026-10-01", { leaveType: "육아휴직" })];
    const r = run(events, "2030-12-31");
    expect([r.status, r.leaveType, r.dept]).toEqual(["휴직", "육아휴직", "외래"]);
    expect(r.warnings).toEqual([]);
  });

  it("11. 퇴직 뒤 복직 기록은 무시하고 퇴직 유지 + 경고", () => {
    const events = [
      hire(),
      ev("termination", "2026-10-01"),
      ev("return", "2026-10-05", { id: "RX" }),
    ];
    const r = run(events, "2026-10-28");
    expect(r.status).toBe("퇴직");
    expect(r.warnings.some((w) => w.includes("RX"))).toBe(true);
  });

  it("12. 날짜가 하루 차이인 경계: 종료일 당일은 휴직, 다음 날은 현원", () => {
    const events = [
      hire(),
      ev("leave_start", "2026-09-01", { endDate: "2026-10-27", leaveType: "병가" }),
    ];
    expect(run(events, "2026-10-27").status).toBe("휴직");
    expect(run(events, "2026-10-28").status).toBe("현원");
  });

  it("13. 입사 전 기준일은 입사예정, 입사일부터 현원", () => {
    const events = [ev("hire", "2026-11-01", { dept: "응급실" })];
    expect(brief(events, "2026-10-28")).toEqual(["입사예정", null, "응급실"]);
    expect(brief(events, "2026-11-01")).toEqual(["현원", null, "응급실"]);
  });

  it("14. 같은 입력을 2회 계산하면 결과가 같고 입력은 바뀌지 않음", () => {
    const events = [
      hire(),
      ev("leave_start", "2026-10-28", { leaveType: "육아휴직" }),
      ev("transfer", "2025-01-01", { dept: "외래2" }),
    ];
    const before = JSON.stringify(events);
    expect(run(events, "2026-10-28")).toEqual(run(events, "2026-10-28"));
    expect(JSON.stringify(events)).toBe(before);
  });
});

describe("인사상태 엔진 — 추가 예외 확인", () => {
  it("종료일이 빈 글자(\"\")이면 진행 중으로 보고 경고", () => {
    const events = [
      hire(),
      ev("leave_start", "2026-10-01", { id: "BAD", endDate: "", leaveType: "병가" }),
    ];
    const r = run(events, "2026-11-01");
    expect([r.status, r.leaveType]).toEqual(["휴직", "병가"]);
    expect(r.warnings.some((w) => w.includes("BAD"))).toBe(true);
  });

  it("다른 사번의 기록은 무시 (\"101\"과 \"T00101\"은 다른 직원)", () => {
    const events = [hire(), ev("hire", "2020-01-01", { employeeId: "101", dept: "다른부서" })];
    expect(run(events, "2026-11-01").dept).toBe("외래");
  });

  it("효력일 형식이 틀린 기록은 무시하고 경고", () => {
    const events = [hire(), ev("leave_start", "2026-1-5", { id: "BADDATE" })];
    const r = run(events, "2026-11-01");
    expect(r.status).toBe("현원");
    expect(r.warnings).toHaveLength(1);
  });

  it("같은 날 같은 종류 기록이 2건이면 고유번호 순으로 처리하고 경고", () => {
    const events = [
      hire(),
      ev("transfer", "2026-05-01", { id: "T1", dept: "A" }),
      ev("transfer", "2026-05-01", { id: "T2", dept: "B" }),
    ];
    const r = run(events, "2026-11-01");
    expect(r.dept).toBe("B");
    expect(r.warnings).toHaveLength(1);
    // 화면에 그대로 보이는 문구이므로 한국어 종류 이름과 두 기록 번호가 들어 있어야 함
    expect(r.warnings[0]).toContain("부서이동");
    expect(r.warnings[0]).not.toContain("transfer");
    expect(r.warnings[0]).toContain("T1");
    expect(r.warnings[0]).toContain("T2");
  });

  it("기준일 형식이 틀리면 오류", () => {
    expect(() => run([hire()], "2026-1-5")).toThrow(RangeError);
  });

  it("기록이 하나도 없으면 현원으로 두고 경고", () => {
    const r = run([], "2026-11-01");
    expect(r.status).toBe("현원");
    expect(r.warnings).toHaveLength(1);
  });
});
