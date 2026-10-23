import type { EmployeeStatus } from "@/lib/hr/types";

// 상태별 뱃지 색상 (밝은 화면과 어두운 화면 모두에서 글자가 읽히게 정했습니다)
const STATUS_STYLE: Record<EmployeeStatus, string> = {
  현원: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  휴직: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  퇴직: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  입사예정: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
};

export function StatusBadge({
  status,
  leaveType,
}: {
  status: EmployeeStatus;
  leaveType: string | null;
}) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {status}
      {leaveType ? ` · ${leaveType}` : ""}
    </span>
  );
}
