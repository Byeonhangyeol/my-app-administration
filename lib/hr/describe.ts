// 타임라인의 기록 한 건을 사람이 읽는 한 줄 문장으로 바꿉니다.

import type { TimelineItem } from "./queries";

export function describeEvent(item: TimelineItem): string {
  switch (item.kind) {
    case "hire":
      return item.dept ? `${item.dept}에 입사` : "입사";
    case "transfer":
      return item.dept ? `${item.dept}(으)로 부서이동` : "부서이동 (부서 정보 없음)";
    case "leave_start": {
      const type = item.leaveType ?? "휴직·휴가";
      return item.endDate ? `${type} 시작 (종료일 ${item.endDate})` : `${type} 시작 (종료일 없음)`;
    }
    case "return":
      return "복직";
    case "termination":
      return "퇴직";
  }
}
