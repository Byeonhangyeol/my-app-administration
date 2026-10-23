// 직원 목록의 부서·상태·경고 필터. 주소의 값은 믿지 않고, 허용된 값만 받아들입니다.

import type { EmployeeRow } from "./queries";
import type { EmployeeStatus } from "./types";

export const STATUS_LIST: readonly EmployeeStatus[] = ["현원", "휴직", "퇴직", "입사예정"];

export interface ListFilter {
  dept: string | null;
  status: EmployeeStatus | null;
  /** true 이면 확인이 필요한 기록(경고)이 있는 직원만 */
  warnOnly: boolean;
}

/** 주소 값이 문자열 하나이거나 여러 개(배열)일 수 있어서 첫 번째 값만 꺼냅니다. */
export function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** 목록에 나오는 부서 이름들 (중복 없이 가나다순) */
export function listDepts(rows: readonly EmployeeRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) if (row.dept) set.add(row.dept);
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}

/**
 * 주소에서 받은 필터 값을 검사합니다.
 * 목록에 없는 부서나 모르는 상태는 "전체"로 보고, 경고 필터는 값이 정확히 "1"일 때만 켭니다.
 */
export function parseFilter(
  dept: string | undefined,
  status: string | undefined,
  knownDepts: readonly string[],
  warn?: string,
): ListFilter {
  return {
    dept: dept !== undefined && knownDepts.includes(dept) ? dept : null,
    status:
      status !== undefined && (STATUS_LIST as readonly string[]).includes(status)
        ? (status as EmployeeStatus)
        : null,
    warnOnly: warn === "1",
  };
}

export function applyFilter(rows: readonly EmployeeRow[], filter: ListFilter): EmployeeRow[] {
  return rows.filter(
    (row) =>
      (filter.dept === null || row.dept === filter.dept) &&
      (filter.status === null || row.status === filter.status) &&
      (!filter.warnOnly || row.warnings.length > 0),
  );
}
