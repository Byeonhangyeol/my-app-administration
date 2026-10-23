// 가명 시드 데이터를 불러옵니다. (읽기 전용, 실제 인사정보는 넣지 않습니다)

import seed from "../../data/seed-employees.json";
import type { Employee, HrEvent } from "./types";

export interface HrData {
  employees: readonly Employee[];
  events: readonly HrEvent[];
}

export const SEED_NOTICE: string = seed.notice;

export const SEED_DATA: HrData = {
  employees: seed.employees as Employee[],
  events: seed.events as HrEvent[],
};
