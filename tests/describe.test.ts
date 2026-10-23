// 타임라인 문장 만들기 테스트, 그리고 상세 타임라인이 시드 시나리오와 맞는지 확인

import { describe, expect, it } from "vitest";
import { describeEvent } from "../lib/hr/describe";
import { handleDetailRequest, type EmployeeDetailBody, type TimelineItem } from "../lib/hr/queries";

function item(o: Partial<TimelineItem>): TimelineItem {
  return {
    id: "X",
    kind: "hire",
    kindLabel: "입사",
    effectiveDate: "2026-01-01",
    endDate: null,
    dept: null,
    leaveType: null,
    source: "actual",
    applied: true,
    isEvidence: false,
    hasWarning: false,
    ...o,
  };
}

describe("describeEvent", () => {
  it("입사·이동·복직·퇴직", () => {
    expect(describeEvent(item({ kind: "hire", dept: "외래" }))).toBe("외래에 입사");
    expect(describeEvent(item({ kind: "hire" }))).toBe("입사");
    expect(describeEvent(item({ kind: "transfer", dept: "수술실" }))).toBe("수술실(으)로 부서이동");
    expect(describeEvent(item({ kind: "return" }))).toBe("복직");
    expect(describeEvent(item({ kind: "termination" }))).toBe("퇴직");
  });

  it("휴직은 종류와 종료일을 함께 보여주고, 종료일이 없으면 그렇게 적음", () => {
    expect(
      describeEvent(item({ kind: "leave_start", leaveType: "병가", endDate: "2026-03-31" })),
    ).toBe("병가 시작 (종료일 2026-03-31)");
    expect(describeEvent(item({ kind: "leave_start", leaveType: "육아휴직" }))).toBe(
      "육아휴직 시작 (종료일 없음)",
    );
  });
});

describe("상세 타임라인 (시드 데이터)", () => {
  const detail = (id: string, asOf: string) =>
    handleDetailRequest(id, asOf).body as EmployeeDetailBody;

  it("1번: 출산휴가 종료 다음 날 육아휴직이 근거, 날짜순", () => {
    const d = detail("T00101", "2026-10-28");
    expect(d.timeline.map((t) => t.effectiveDate)).toEqual([...d.timeline.map((t) => t.effectiveDate)].sort());
    const evidence = d.timeline.filter((t) => t.isEvidence).map((t) => describeEvent(t));
    expect(evidence).toEqual(["병동A에 입사", "육아휴직 시작 (종료일 없음)"]);
  });

  it("같은 직원도 기준일에 따라 근거가 바뀜: 10/27에는 출산휴가가 근거", () => {
    const d = detail("T00101", "2026-10-27");
    const evidence = d.timeline.filter((t) => t.isEvidence).map((t) => t.leaveType);
    expect(evidence).toContain("출산휴가");
    // 10/28에 시작하는 육아휴직은 아직 적용되지 않음
    const future = d.timeline.filter((t) => !t.applied);
    expect(future).toHaveLength(1);
    expect(future[0].leaveType).toBe("육아휴직");
  });

  it("5번: 미래 기록 2건은 '적용 안 됨', 자동 생성 기록은 출처가 auto", () => {
    expect(detail("T00105", "2026-10-28").timeline.filter((t) => !t.applied)).toHaveLength(2);
    const auto = detail("T00104", "2026-10-28").timeline.filter((t) => t.source === "auto");
    expect(auto).toHaveLength(1);
    expect(auto[0].kind).toBe("return");
  });

  it("경고가 언급한 기록에만 hasWarning 표시 (3번: 종료일 없는 휴직과 그것을 끝낸 복직)", () => {
    const d = detail("T00103", "2026-10-28");
    expect(d.warnings).toHaveLength(1);
    // 경고 문구가 휴직 기록과 복직 기록을 모두 언급하므로 두 기록에 표시되고, 입사 기록에는 표시되지 않음
    const flagged = d.timeline.filter((t) => t.hasWarning).map((t) => describeEvent(t));
    expect(flagged).toEqual(["병가 시작 (종료일 없음)", "복직"]);
  });

  it("같은 날 같은 종류 2건(14번)은 경고 문구에 두 기록 번호가 모두 나오고 둘 다 표시", () => {
    const d = detail("T00114", "2026-10-28");
    expect(d.warnings).toHaveLength(1);
    expect(d.timeline.filter((t) => t.hasWarning)).toHaveLength(2);
  });

  it("경고가 없는 직원은 hasWarning 이 하나도 없음", () => {
    expect(detail("T00102", "2026-10-28").timeline.some((t) => t.hasWarning)).toBe(false);
  });

  it("퇴직한 직원(8번)의 근거에 퇴직 기록이 포함", () => {
    const d = detail("T00108", "2026-10-28");
    expect(d.status).toBe("퇴직");
    expect(d.timeline.some((t) => t.isEvidence && t.kind === "termination")).toBe(true);
  });
});
