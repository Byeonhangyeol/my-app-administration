import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { StatusBadge } from "./_components/status-badge";
import {
  applyFilter,
  firstValue,
  listDepts,
  parseFilter,
  STATUS_LIST,
} from "@/lib/hr/filter";
import { handleListRequest, type EmployeeListBody } from "@/lib/hr/queries";
import { koreaToday } from "@/lib/hr/today";
import type { EmployeeStatus } from "@/lib/hr/types";

export const metadata: Metadata = {
  title: "직원 목록 | 간호인력 통합관리",
};

const CONTROL =
  "rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700 dark:[color-scheme:dark]";

// 바깥 틀(제목)은 미리 만들어 두고, 주소의 값(기준일·필터)을 읽는 부분만 요청 시점에 만듭니다.
export default function EmployeesPage({ searchParams }: PageProps<"/employees">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold">직원 목록</h1>
      <Suspense fallback={<p className="text-sm text-zinc-600 dark:text-zinc-400">불러오는 중...</p>}>
        <EmployeeList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function EmployeeList({
  searchParams,
}: Pick<PageProps<"/employees">, "searchParams">) {
  const params = await searchParams;
  const rawAsOf = firstValue(params.asOf);

  // 기준일이 없으면 한국 시간 기준 오늘을 씁니다. 현재 시각은 요청 시점에만 읽습니다.
  let asOf: string;
  if (rawAsOf === undefined || rawAsOf === "") {
    await connection();
    asOf = koreaToday();
  } else {
    asOf = rawAsOf;
  }

  // 화면은 서버가 계산한 상태를 보여주기만 합니다. 상태 계산은 직접 하지 않습니다.
  const result = handleListRequest(asOf);

  if (result.status !== 200) {
    return (
      <>
        <FilterForm asOf="" dept={null} status={null} warnOnly={false} depts={[]} />
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          기준일 형식이 올바르지 않습니다. YYYY-MM-DD 형식의 실제 날짜를 선택해 주세요.
        </p>
      </>
    );
  }

  const body = result.body as EmployeeListBody;
  const depts = listDepts(body.employees);
  const filter = parseFilter(
    firstValue(params.dept),
    firstValue(params.status),
    depts,
    firstValue(params.warn),
  );
  const rows = applyFilter(body.employees, filter);

  return (
    <>
      <FilterForm
        asOf={body.asOf}
        dept={filter.dept}
        status={filter.status}
        warnOnly={filter.warnOnly}
        depts={depts}
      />

      <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {body.notice}
      </p>

      <section aria-label={`${body.asOf} 기준 인원 집계`} className="mb-5">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <dt className="text-xs text-zinc-600 dark:text-zinc-400">총원</dt>
            <dd className="text-2xl font-semibold tabular-nums">{body.total}</dd>
          </div>
          {STATUS_LIST.map((status) => (
            <div
              key={status}
              className="rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800"
            >
              <dt className="text-xs text-zinc-600 dark:text-zinc-400">{status}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{body.counts[status]}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          집계는 부서·상태 필터와 상관없이 {body.asOf} 기준 전체 인원입니다.
        </p>
        <p className="mt-2 text-sm">
          확인이 필요한 기록이 있는 직원: <strong className="tabular-nums">{body.warningCount}명</strong>
          {body.warningCount > 0 && !filter.warnOnly && (
            <>
              {" "}
              <Link
                href={`/employees?asOf=${body.asOf}&warn=1`}
                className="underline underline-offset-2"
              >
                해당 직원만 보기
              </Link>
            </>
          )}
        </p>
      </section>

      <p className="mb-2 text-sm" aria-live="polite">
        {rows.length}명 표시 (전체 {body.total}명)
      </p>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[38rem] border-collapse text-sm">
          <caption className="sr-only">{body.asOf} 기준 직원 목록</caption>
          <thead className="bg-zinc-100 text-left dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">사번</th>
              <th scope="col" className="px-3 py-2 font-medium">이름</th>
              <th scope="col" className="px-3 py-2 font-medium">부서</th>
              <th scope="col" className="px-3 py-2 font-medium">상태</th>
              <th scope="col" className="px-3 py-2 font-medium">확인 필요</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="border-t border-zinc-200 dark:border-zinc-800">
                <td colSpan={5} className="px-3 py-4 text-center text-zinc-600 dark:text-zinc-400">
                  조건에 맞는 직원이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((employee) => (
                <tr
                  key={employee.id}
                  className="border-t border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  {/* 사번과 이름을 누르면 그 직원의 상세 화면으로 갑니다. 보고 있던 기준일을 함께 넘깁니다. */}
                  <td className="px-3 py-1.5 font-mono tabular-nums">
                    <Link
                      href={`/employees/${encodeURIComponent(employee.id)}?asOf=${body.asOf}`}
                      className="underline underline-offset-2"
                    >
                      {employee.id}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/employees/${encodeURIComponent(employee.id)}?asOf=${body.asOf}`}
                      className="hover:underline"
                    >
                      {employee.name}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">{employee.dept ?? "-"}</td>
                  <td className="px-3 py-1.5">
                    <StatusBadge status={employee.status} leaveType={employee.leaveType} />
                  </td>
                  <td className="px-3 py-1.5">
                    {employee.warnings.length > 0 ? (
                      // 경고가 있으면 상세 화면의 "확인이 필요한 기록" 부분으로 바로 갑니다.
                      <Link
                        href={`/employees/${encodeURIComponent(employee.id)}?asOf=${body.asOf}#warnings`}
                        className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 underline-offset-2 hover:underline dark:bg-amber-950 dark:text-amber-200"
                      >
                        <span aria-hidden="true">⚠ </span>경고 {employee.warnings.length}건
                      </Link>
                    ) : (
                      <span className="text-zinc-400 dark:text-zinc-600">
                        <span aria-hidden="true">-</span>
                        <span className="sr-only">경고 없음</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// 기준일·부서·상태를 고르는 조회 양식. 자바스크립트 없이 주소(?asOf=...)로 다시 불러오는 방식입니다.
function FilterForm({
  asOf,
  dept,
  status,
  warnOnly,
  depts,
}: {
  asOf: string;
  dept: string | null;
  status: EmployeeStatus | null;
  warnOnly: boolean;
  depts: string[];
}) {
  return (
    <form method="get" action="/employees" className="mb-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        기준일
        <input type="date" name="asOf" defaultValue={asOf} className={CONTROL} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        부서
        <select name="dept" defaultValue={dept ?? ""} className={CONTROL}>
          <option value="">전체</option>
          {depts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        상태
        <select name="status" defaultValue={status ?? ""} className={CONTROL}>
          <option value="">전체</option>
          {STATUS_LIST.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 pb-1 text-sm">
        <input type="checkbox" name="warn" value="1" defaultChecked={warnOnly} />
        경고 있는 직원만
      </label>
      <button
        type="submit"
        className="rounded bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        조회
      </button>
      <Link href="/employees" className="px-1 py-1 text-sm underline">
        초기화
      </Link>
    </form>
  );
}
