// 조회 API의 처리 로직입니다. Next.js와 상관없는 순수 함수라서 테스트하기 쉽습니다.
// 화면은 여기서 돌려준 결과를 보여주기만 하고, 상태는 직접 계산하지 않습니다.

import { SEED_DATA, SEED_NOTICE, type HrData } from "./data";
import { compareDates, isValidDateString } from "./date";
import { resolveStatus } from "./engine";
import type { EmployeeStatus, HrEvent, HrEventKind } from "./types";

/** API 응답: HTTP 상태 번호와 본문 */
export interface ApiResponse {
  status: number;
  body: unknown;
}

/** 목록의 한 줄 */
export interface EmployeeRow {
  id: string;
  name: string;
  dept: string | null;
  status: EmployeeStatus;
  leaveType: string | null;
  warnings: string[];
}

/** 목록 API의 성공 응답 본문 */
export interface EmployeeListBody {
  asOf: string;
  notice: string;
  total: number;
  counts: Record<EmployeeStatus, number>;
  /** 확인이 필요한 기록(경고)이 있는 직원 수 */
  warningCount: number;
  employees: EmployeeRow[];
}

/** 상세 화면 타임라인의 한 줄 */
export interface TimelineItem {
  id: string;
  kind: HrEventKind;
  kindLabel: string;
  effectiveDate: string;
  endDate: string | null;
  dept: string | null;
  leaveType: string | null;
  source: HrEvent["source"];
  /** 기준일 이전(포함)에 효력이 생긴 기록인지 */
  applied: boolean;
  /** 상태 판정의 근거가 된 기록인지 */
  isEvidence: boolean;
  /** 이 기록이 경고 문구에 언급됐는지 (확인이 필요한 기록) */
  hasWarning: boolean;
}

/**
 * 인사 기록을 직원별로 한 번만 나눠 둡니다.
 * 직원마다 전체 기록을 다시 걸러 내면 (직원 수 × 전체 기록 수)만큼 반복해서 규모가 커질수록 급격히 느려집니다.
 * 기록의 순서는 입력 순서 그대로 유지합니다. (엔진이 알아서 정렬합니다)
 */
function groupEventsByEmployee(events: readonly HrEvent[]): Map<string, HrEvent[]> {
  const byEmployee = new Map<string, HrEvent[]>();
  for (const e of events) {
    const list = byEmployee.get(e.employeeId);
    if (list) list.push(e);
    else byEmployee.set(e.employeeId, [e]);
  }
  return byEmployee;
}

/** 경고 문구 안에 이 기록의 고유번호가 (다른 글자에 붙지 않고) 그대로 들어 있는지 */
function mentionedIn(warnings: readonly string[], eventId: string): boolean {
  const escaped = eventId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`);
  return warnings.some((w) => pattern.test(w));
}

/** 상세 API의 성공 응답 본문 */
export interface EmployeeDetailBody {
  asOf: string;
  notice: string;
  employee: { id: string; name: string };
  status: EmployeeStatus;
  leaveType: string | null;
  dept: string | null;
  warnings: string[];
  timeline: TimelineItem[];
}

const KIND_LABEL: Record<HrEventKind, string> = {
  hire: "입사",
  transfer: "부서이동",
  leave_start: "휴직·휴가 시작",
  return: "복직",
  termination: "퇴직",
};

/** 오류 응답. 보안을 위해 입력받은 값은 오류 메시지에 되돌려 적지 않습니다. */
function errorResponse(status: number, code: string, message: string): ApiResponse {
  return { status, body: { error: { code, message } } };
}

/** 기준일 검사. 없거나 형식이 틀리면 400 응답을, 통과하면 null을 돌려줍니다. */
function checkAsOf(asOf: string | null): ApiResponse | null {
  if (asOf === null || !isValidDateString(asOf)) {
    return errorResponse(
      400,
      "INVALID_AS_OF",
      "기준일(asOf)이 없거나 형식이 올바르지 않습니다. YYYY-MM-DD 형식의 실제 날짜를 입력하세요.",
    );
  }
  return null;
}

/** 직원 목록과 상태별 집계 (GET /api/employees?asOf=YYYY-MM-DD) */
export function handleListRequest(
  asOf: string | null,
  data: HrData = SEED_DATA,
): ApiResponse {
  const invalid = checkAsOf(asOf);
  if (invalid || asOf === null) return invalid as ApiResponse;

  const counts: Record<EmployeeStatus, number> = {
    현원: 0,
    휴직: 0,
    퇴직: 0,
    입사예정: 0,
  };
  const byEmployee = groupEventsByEmployee(data.events);
  const rows: EmployeeRow[] = [...data.employees]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((employee) => {
      const r = resolveStatus(employee.id, byEmployee.get(employee.id) ?? [], asOf);
      counts[r.status] += 1;
      return {
        id: employee.id,
        name: employee.name,
        dept: r.dept,
        status: r.status,
        leaveType: r.leaveType,
        warnings: r.warnings,
      };
    });

  const body: EmployeeListBody = {
    asOf,
    notice: SEED_NOTICE,
    total: rows.length,
    counts,
    warningCount: rows.filter((r) => r.warnings.length > 0).length,
    employees: rows,
  };
  return { status: 200, body };
}

/** 직원 한 명의 상태와 근거 타임라인 (GET /api/employees/[id]?asOf=YYYY-MM-DD) */
export function handleDetailRequest(
  id: string,
  asOf: string | null,
  data: HrData = SEED_DATA,
): ApiResponse {
  // 기준일 검사가 항상 먼저입니다. (잘못된 기준일이면 사번이 없어도 400)
  const invalid = checkAsOf(asOf);
  if (invalid || asOf === null) return invalid as ApiResponse;

  const employee = data.employees.find((e) => e.id === id);
  if (!employee) {
    return errorResponse(404, "EMPLOYEE_NOT_FOUND", "해당 사번의 직원을 찾을 수 없습니다.");
  }

  // 이 직원의 기록만 한 번 걸러서 상태 계산과 타임라인에 함께 씁니다.
  const own = data.events.filter((e) => e.employeeId === employee.id);
  const result = resolveStatus(employee.id, own, asOf);
  const timeline: TimelineItem[] = [...own]
    .sort(
      (a: HrEvent, b: HrEvent) =>
        compareDates(a.effectiveDate, b.effectiveDate) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      kindLabel: KIND_LABEL[e.kind],
      effectiveDate: e.effectiveDate,
      endDate: e.endDate,
      dept: e.dept,
      leaveType: e.leaveType,
      source: e.source,
      // 기준일 이전(포함)에 효력이 생긴 기록인지, 상태 판정의 근거가 된 기록인지
      applied: isValidDateString(e.effectiveDate) && compareDates(e.effectiveDate, asOf) <= 0,
      isEvidence: result.evidence.includes(e.id),
      hasWarning: mentionedIn(result.warnings, e.id),
    }));

  const body: EmployeeDetailBody = {
    asOf,
    notice: SEED_NOTICE,
    employee: { id: employee.id, name: employee.name },
    status: result.status,
    leaveType: result.leaveType,
    dept: result.dept,
    warnings: result.warnings,
    timeline,
  };
  return { status: 200, body };
}
