// 속도 측정용 가명 합성 데이터 생성기입니다. (앱에는 들어가지 않고 테스트에서만 씁니다)
// 같은 씨앗(seed)이면 항상 같은 데이터가 나옵니다. 실제 인사정보와 무관한 가짜 값입니다.

import type { HrData } from "../../lib/hr/data";
import type { Employee, HrEvent } from "../../lib/hr/types";

/** 작고 빠른 난수 생성기 (mulberry32). 같은 씨앗이면 같은 수열 */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEPTS = ["외래", "중환자실", "응급실", "수술실", "병동A", "병동B", "병동C", "병동D", "내시경실", "투석실"];
const LEAVE_TYPES = ["병가", "육아휴직", "출산휴가", "질병휴직"];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 2005-01-01 부터 days 일 뒤의 날짜를 "YYYY-MM-DD" 로 (윤년 포함, 28일까지만 써서 항상 실제 날짜) */
function dateFrom(index: number): string {
  const year = 2005 + Math.floor(index / 336);
  const rest = index % 336;
  return `${year}-${pad(1 + Math.floor(rest / 28))}-${pad(1 + (rest % 28))}`;
}

/**
 * 가명 직원 count명과 그들의 인사 기록을 만듭니다.
 * 구성(대략): 모두 입사, 약 60%가 부서이동 1~3회, 약 12%가 휴직, 약 6%가 퇴직,
 * 약 1%가 입사예정, 약 2%는 같은 날 이동 2건(경고 대상).
 */
export function generateSynthetic(count = 1500, seed = 20261028): HrData {
  const rnd = makeRandom(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  const employees: Employee[] = [];
  const events: HrEvent[] = [];
  let n = 0;

  const add = (
    employeeId: string,
    kind: HrEvent["kind"],
    effectiveDate: string,
    o: Partial<HrEvent> = {},
  ) => {
    n += 1;
    events.push({
      id: `SEV${pad(n, 6)}`,
      employeeId,
      kind,
      effectiveDate,
      endDate: null,
      dept: null,
      leaveType: null,
      source: "actual",
      recordedAt: "2026-10-23",
      ...o,
    });
  };

  for (let i = 1; i <= count; i++) {
    const id = `S${pad(i, 5)}`;
    employees.push({ id, name: `합성직원${pad(i, 4)}` });

    // 입사: 2005년 ~ 2025년, 약 1%는 2026-11 이후(입사예정)
    const futureHire = rnd() < 0.01;
    const hireIndex = futureHire ? 21 * 336 + 10 * 28 + Math.floor(rnd() * 28) : Math.floor(rnd() * 20 * 336);
    const hireDate = dateFrom(hireIndex);
    add(id, "hire", hireDate, { dept: pick(DEPTS) });
    if (futureHire) continue;

    // 부서이동 0~3회 (입사 이후)
    if (rnd() < 0.6) {
      const moves = 1 + Math.floor(rnd() * 3);
      let idx = hireIndex;
      for (let m = 0; m < moves; m++) {
        idx += 28 + Math.floor(rnd() * 600);
        if (idx > 21 * 336) break;
        add(id, "transfer", dateFrom(idx), { dept: pick(DEPTS) });
      }
    }

    // 같은 날 이동 2건 (경고 대상) 약 2%
    if (rnd() < 0.02) {
      const d = dateFrom(Math.min(hireIndex + 400, 20 * 336));
      add(id, "transfer", d, { dept: pick(DEPTS) });
      add(id, "transfer", d, { dept: pick(DEPTS) });
    }

    // 휴직 약 12%: 끝난 휴직 또는 진행 중인 휴직(종료일 없음)
    if (rnd() < 0.12) {
      const start = Math.min(hireIndex + 100 + Math.floor(rnd() * 3000), 21 * 336 + 9 * 28);
      const ongoing = rnd() < 0.3;
      add(id, "leave_start", dateFrom(start), {
        leaveType: pick(LEAVE_TYPES),
        endDate: ongoing ? null : dateFrom(Math.min(start + 28 + Math.floor(rnd() * 300), 22 * 336)),
      });
    }

    // 퇴직 약 6%
    if (rnd() < 0.06) {
      add(id, "termination", dateFrom(Math.min(hireIndex + 500 + Math.floor(rnd() * 3000), 21 * 336 + 9 * 28)));
    }
  }

  return { employees, events };
}
