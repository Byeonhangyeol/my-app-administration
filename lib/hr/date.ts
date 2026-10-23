// 날짜 문자열("YYYY-MM-DD") 비교와 기간 판정 유틸입니다.
// 시간대 때문에 하루가 어긋나지 않도록 날짜 비교에는 Date 객체를 쓰지 않습니다.
// 이 파일은 다른 파일을 불러오지 않는 독립 파일입니다.

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 윤년 여부 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 해당 월의 마지막 날짜 (month는 1~12) */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * "YYYY-MM-DD" 형식이고 실제로 있는 날짜인지 검사합니다.
 * "2026-1-5", "20261028", "2026-02-30" 은 false 입니다.
 */
export function isValidDateString(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

/**
 * 두 날짜를 비교합니다. a가 빠르면 음수, 같으면 0, 늦으면 양수입니다.
 * 형식이 맞는 날짜끼리는 글자 순서가 곧 날짜 순서입니다.
 */
export function compareDates(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * 기준일이 기간 안에 있는지 판정합니다. 시작일과 종료일을 모두 포함합니다(잠정 정책).
 * 종료일이 null이면 진행 중이므로 시작일 이후이기만 하면 true 입니다.
 */
export function isDateInRange(
  date: string,
  start: string,
  end: string | null,
): boolean {
  if (compareDates(date, start) < 0) return false;
  if (end === null) return true;
  return compareDates(date, end) <= 0;
}
