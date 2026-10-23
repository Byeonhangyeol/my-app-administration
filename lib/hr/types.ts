// DESIGN.md "2-1. 데이터 구조"를 그대로 옮긴 타입 모음입니다.

/** "YYYY-MM-DD" 형식의 날짜 문자열. Date 객체로 바꾸지 않고 문자열 그대로 비교합니다. */
export type DateString = string;

/** 인사 기록의 종류 */
export type HrEventKind =
  | "hire" // 입사
  | "transfer" // 부서 이동
  | "leave_start" // 휴직 시작 (세부 종류는 leaveType)
  | "return" // 복직
  | "termination"; // 퇴직

/** 기록의 출처: 사람이 입력했는지, 자동 생성됐는지 */
export type HrEventSource = "actual" | "auto";

/** 직원. 사번은 앞자리 0을 지키려고 항상 문자열입니다. */
export interface Employee {
  id: string;
  name: string;
}

/** 인사 기록 한 건 */
export interface HrEvent {
  /** 기록 고유번호. 같은 날 정렬의 마지막 기준 */
  id: string;
  /** 직원 사번 */
  employeeId: string;
  kind: HrEventKind;
  /** 효력일 (이 날부터 적용) */
  effectiveDate: DateString;
  /** 종료일. 휴직 시작에서만 사용하고, 비어 있으면 null */
  endDate: DateString | null;
  /** 입사·이동 기록의 부서 */
  dept: string | null;
  /** 휴직 시작 기록의 세부 종류 (예: 출산휴가, 육아휴직, 병가) */
  leaveType: string | null;
  source: HrEventSource;
  /** 입력된 날. 효력일과 별도로 보관 */
  recordedAt: DateString;
}

/** 기준일의 상태 (4종) */
export type EmployeeStatus = "현원" | "휴직" | "퇴직" | "입사예정";

/** 상태 엔진의 계산 결과 */
export interface ResolvedStatus {
  status: EmployeeStatus;
  /** 상태가 휴직일 때만 세부 종류, 그 외에는 null */
  leaveType: string | null;
  /** 기준일의 부서 */
  dept: string | null;
  /** 이 상태를 만든 기록의 id 목록 */
  evidence: string[];
  /** 판정이 애매한 기록의 사유 */
  warnings: string[];
}
