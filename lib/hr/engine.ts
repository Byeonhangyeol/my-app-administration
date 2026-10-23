// 인사상태 엔진: 직원 한 명의 인사 기록과 기준일을 받아 그 날의 상태와 부서를 계산합니다.
// 입력을 바꾸지 않는 순수 함수이고, 같은 입력이면 항상 같은 결과를 돌려줍니다.
// 판정 규칙은 DESIGN.md의 "상태 엔진 규칙"과 "같은 날 우선순위 표"를 따릅니다.
// 기간 포함 정책, 같은 날 우선순위, 입사일·퇴직일 당일 상태는 모두 잠정입니다(원본 VBA 대조 후 확정).

import { compareDates, isDateInRange, isValidDateString } from "./date";
import type {
  HrEvent,
  HrEventKind,
  HrEventSource,
  ResolvedStatus,
} from "./types";

// 같은 날 정렬 순서: 앞이 먼저 반영되고, 나중에 반영된 기록이 최종 상태가 됩니다.
const SOURCE_RANK: Record<HrEventSource, number> = { auto: 0, actual: 1 };
const KIND_RANK: Record<HrEventKind, number> = {
  hire: 0,
  transfer: 1,
  return: 2,
  leave_start: 3,
  termination: 4,
};

// 경고 문구에 쓰는 한국어 종류 이름
const KIND_NAME: Record<HrEventKind, string> = {
  hire: "입사",
  transfer: "부서이동",
  leave_start: "휴직·휴가 시작",
  return: "복직",
  termination: "퇴직",
};

/** 효력일 → 출처 → 종류 → 기록 고유번호 순으로 비교합니다. */
function compareEvents(a: HrEvent, b: HrEvent): number {
  return (
    compareDates(a.effectiveDate, b.effectiveDate) ||
    SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** 계산에 쓰는 휴직 정보: 시작 기록과 (검사를 거친) 종료일 */
interface Leave {
  event: HrEvent;
  end: string | null;
}

/**
 * 직원 한 명의 기준일 상태를 계산합니다.
 * @param employeeId 대상 직원의 사번 (다른 사번의 기록은 무시합니다)
 * @param events 인사 기록 목록 (순서는 상관없고, 원본은 바꾸지 않습니다)
 * @param asOf 기준일 "YYYY-MM-DD" (형식이 틀리면 오류, API가 먼저 검사해야 합니다)
 */
export function resolveStatus(
  employeeId: string,
  events: readonly HrEvent[],
  asOf: string,
): ResolvedStatus {
  if (!isValidDateString(asOf)) {
    throw new RangeError("기준일 형식이 올바르지 않습니다 (YYYY-MM-DD)");
  }

  const warnings: string[] = [];

  // 1) 이 직원의 기록 중 효력일이 올바른 것만 모읍니다. (입력 배열은 그대로 두고 새 배열을 씁니다)
  const valid: HrEvent[] = [];
  for (const e of events) {
    if (e.employeeId !== employeeId) continue;
    if (typeof e.effectiveDate !== "string" || !isValidDateString(e.effectiveDate)) {
      warnings.push(`기록 ${e.id}: 효력일 형식이 올바르지 않아 무시했습니다`);
      continue;
    }
    valid.push(e);
  }
  valid.sort(compareEvents);

  // 2) 기록별 종료일을 검사합니다. 형식이 틀리면 "종료일 없음"으로 보고 경고합니다.
  const endOf = new Map<string, string | null>();
  for (const e of valid) {
    if (e.kind !== "leave_start") continue;
    if (e.endDate === null || e.endDate === undefined) {
      endOf.set(e.id, null);
    } else if (!isValidDateString(e.endDate)) {
      warnings.push(`기록 ${e.id}: 종료일 형식이 올바르지 않아 종료일 없음으로 처리했습니다`);
      endOf.set(e.id, null);
    } else {
      if (compareDates(e.endDate, e.effectiveDate) < 0) {
        warnings.push(`기록 ${e.id}: 종료일이 시작일보다 빠릅니다`);
      }
      endOf.set(e.id, e.endDate);
    }
  }

  // 3) 기준일보다 미래인 기록은 적용하지 않습니다.
  const applicable = valid.filter((e) => compareDates(e.effectiveDate, asOf) <= 0);
  const futureHire = valid.find(
    (e) => e.kind === "hire" && compareDates(e.effectiveDate, asOf) > 0,
  );

  // 같은 날, 같은 출처, 같은 종류의 기록이 2건 이상이면 경고합니다.
  const groups = new Map<string, string[]>();
  for (const e of applicable) {
    const key = `${e.effectiveDate}|${e.source}|${e.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), e.id]);
  }
  for (const [key, ids] of groups) {
    if (ids.length >= 2) {
      const [date, , kind] = key.split("|");
      warnings.push(
        `${date}에 같은 종류(${KIND_NAME[kind as HrEventKind]}) 기록이 ${ids.length}건 있습니다 (기록 ${ids.join(", ")})`,
      );
    }
  }

  // 4) 정렬된 순서대로 하나씩 반영합니다.
  let hire: HrEvent | null = null;
  let deptEvent: HrEvent | null = null;
  let dept: string | null = null;
  let leave: Leave | null = null;
  let lastReturn: HrEvent | null = null;
  let termination: HrEvent | null = null;

  for (const e of applicable) {
    if (termination !== null) {
      warnings.push(`기록 ${e.id}: 퇴직 이후 기록이라 무시했습니다`);
      continue;
    }
    switch (e.kind) {
      case "hire":
        if (hire !== null) {
          warnings.push(`기록 ${e.id}: 입사 기록이 2건 이상이라 무시했습니다`);
          break;
        }
        hire = e;
        deptEvent = e;
        dept = e.dept;
        break;
      case "transfer":
        if (e.dept === null || e.dept === undefined) {
          warnings.push(`기록 ${e.id}: 이동 기록에 부서가 없어 무시했습니다`);
          break;
        }
        deptEvent = e;
        dept = e.dept;
        break;
      case "leave_start":
        if (leave !== null) {
          if (leave.end === null) {
            warnings.push(
              `기록 ${leave.event.id}: 종료일 없는 과거 휴직이며, 기록 ${e.id}이 끝낸 것으로 보았습니다`,
            );
          } else if (compareDates(e.effectiveDate, leave.end) <= 0) {
            warnings.push(
              `기록 ${leave.event.id}과 ${e.id}: 휴직 기간이 겹칩니다 (나중에 시작한 휴직을 표시)`,
            );
          }
        }
        leave = { event: e, end: endOf.get(e.id) ?? null };
        break;
      case "return":
        if (leave === null) {
          warnings.push(`기록 ${e.id}: 휴직 기록 없이 복직 기록만 있어 무시했습니다`);
          break;
        }
        if (leave.end === null) {
          warnings.push(
            `기록 ${leave.event.id}: 종료일 없는 과거 휴직이며, 복직 기록 ${e.id}이 끝낸 것으로 보았습니다`,
          );
        }
        leave = null;
        lastReturn = e;
        break;
      case "termination":
        if (leave !== null && leave.end === null) {
          warnings.push(
            `기록 ${leave.event.id}: 종료일 없는 과거 휴직이며, 퇴직 기록 ${e.id}이 끝낸 것으로 보았습니다`,
          );
        }
        termination = e;
        break;
    }
  }

  // 5) 입사 기록이 아직 적용되지 않았으면 입사예정이거나, 입사 기록이 없는 경우입니다.
  if (hire === null) {
    if (futureHire !== undefined) {
      if (applicable.length > 0) {
        warnings.push(`입사 전 기록이 ${applicable.length}건 있어 적용하지 않았습니다`);
      }
      return {
        status: "입사예정",
        leaveType: null,
        dept: futureHire.dept,
        evidence: [futureHire.id],
        warnings,
      };
    }
    warnings.push("입사 기록이 없어 남은 기록으로만 계산했습니다");
  }

  // 6) 최종 상태를 정합니다. 휴직 기간은 시작일과 종료일을 모두 포함합니다(잠정).
  const evidence: string[] = [];
  const addEvidence = (e: HrEvent | null) => {
    if (e !== null && !evidence.includes(e.id)) evidence.push(e.id);
  };
  addEvidence(deptEvent);

  if (termination !== null) {
    addEvidence(termination);
    return { status: "퇴직", leaveType: null, dept, evidence, warnings };
  }
  if (leave !== null && isDateInRange(asOf, leave.event.effectiveDate, leave.end)) {
    addEvidence(leave.event);
    return {
      status: "휴직",
      leaveType: leave.event.leaveType,
      dept,
      evidence,
      warnings,
    };
  }
  addEvidence(lastReturn);
  return { status: "현원", leaveType: null, dept, evidence, warnings };
}
