// 속도 측정 (npm run bench). 결과는 그 PC에서 잰 값 그대로이며, 목표 달성 여부는 판단하지 않습니다.
// 측정 대상은 "목록·상세 API가 하는 계산"(상태 계산 + 집계)이고, 화면 그리기·네트워크·브라우저 시간은 포함하지 않습니다.

import { bench, describe } from "vitest";
import { SEED_DATA } from "../../lib/hr/data";
import { handleDetailRequest, handleListRequest } from "../../lib/hr/queries";
import { generateSynthetic } from "../helpers/synthetic";

const AS_OF = "2026-10-28";
const big = generateSynthetic(1500);
const half = generateSynthetic(750);
const double = generateSynthetic(3000);

// 응답 크기와 데이터 규모도 함께 기록해 둡니다.
console.log(
  `합성 1,500명: 인사 기록 ${big.events.length}건, 목록 응답 JSON ${Buffer.byteLength(
    JSON.stringify(handleListRequest(AS_OF, big).body),
  )}바이트`,
);

describe("목록 API 계산", () => {
  bench("시드 30명", () => {
    handleListRequest(AS_OF);
  });

  // 규모가 커질 때 시간이 어떻게 늘어나는지 보기 위해 750명, 3,000명도 잽니다.
  bench("합성 750명", () => {
    handleListRequest(AS_OF, half);
  });

  bench("합성 1,500명", () => {
    handleListRequest(AS_OF, big);
  });

  bench("합성 3,000명", () => {
    handleListRequest(AS_OF, double);
  });

  bench("합성 1,500명 + JSON 문자열 변환", () => {
    JSON.stringify(handleListRequest(AS_OF, big).body);
  });
});

describe("상세 API 계산", () => {
  bench("시드 30명 중 1명", () => {
    handleDetailRequest("T00101", AS_OF, SEED_DATA);
  });

  bench("합성 1,500명 중 1명", () => {
    handleDetailRequest("S00750", AS_OF, big);
  });
});
