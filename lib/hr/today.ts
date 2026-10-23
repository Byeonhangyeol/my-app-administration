// 한국 시간 기준 오늘 날짜를 "YYYY-MM-DD" 문자열로 돌려줍니다.
// 현재 시각을 읽는 곳은 이 파일 하나뿐입니다. (날짜 비교에는 Date를 쓰지 않는다는 규칙의 유일한 예외)
// Vercel 서버는 세계 표준시(UTC)로 돌아가서, 시간대를 지정하지 않으면 한국 시간 0~9시에 하루 전 날짜가 나옵니다.
// Next.js의 Cache Components 설정에서는 현재 시각을 읽는 코드가 미리 만들어지는 화면에 있으면 빌드가 실패하므로,
// 이 함수는 요청 시점에만(connection() 뒤, Suspense 안에서) 불러야 합니다.

const SEOUL = "Asia/Seoul";

export function koreaToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
