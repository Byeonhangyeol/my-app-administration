import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { describeEvent } from "@/lib/hr/describe";
import { firstValue } from "@/lib/hr/filter";
import { handleDetailRequest, type EmployeeDetailBody } from "@/lib/hr/queries";
import { koreaToday } from "@/lib/hr/today";
import { StatusBadge } from "../_components/status-badge";

export const metadata: Metadata = {
  title: "직원 상세 | 간호인력 통합관리",
};

const CONTROL =
  "rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700 dark:[color-scheme:dark]";

// 바깥 틀(제목, 목록 링크)은 미리 만들어 두고, 주소의 사번·기준일을 읽는 부분만 요청 시점에 만듭니다.
export default function EmployeeDetailPage({
  params,
  searchParams,
}: PageProps<"/employees/[id]">) {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6">
      <Suspense fallback={<p className="text-sm text-zinc-600 dark:text-zinc-400">불러오는 중...</p>}>
        <EmployeeDetail params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function EmployeeDetail({
  params,
  searchParams,
}: Pick<PageProps<"/employees/[id]">, "params" | "searchParams">) {
  const { id } = await params;
  const query = await searchParams;
  const rawAsOf = firstValue(query.asOf);

  // 기준일이 없으면 한국 시간 기준 오늘을 씁니다. 현재 시각은 요청 시점에만 읽습니다.
  let asOf: string;
  if (rawAsOf === undefined || rawAsOf === "") {
    await connection();
    asOf = koreaToday();
  } else {
    asOf = rawAsOf;
  }

  const result = handleDetailRequest(id, asOf);
  // 목록으로 돌아갈 때 보던 기준일을 이어줍니다. (기준일이 틀렸으면 이어주지 않음)
  const backHref = result.status === 400 ? "/employees" : `/employees?asOf=${asOf}`;

  if (result.status === 400) {
    return (
      <>
        <BackLink href={backHref} />
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          기준일 형식이 올바르지 않습니다. YYYY-MM-DD 형식의 실제 날짜를 선택해 주세요.
        </p>
      </>
    );
  }

  if (result.status === 404) {
    return (
      <>
        <BackLink href={backHref} />
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          해당 사번의 직원을 찾을 수 없습니다.
        </p>
      </>
    );
  }

  const body = result.body as EmployeeDetailBody;

  return (
    <>
      <BackLink href={backHref} />

      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">
          <span className="font-mono tabular-nums">{body.employee.id}</span> {body.employee.name}
        </h1>
        <form method="get" className="flex items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
            기준일
            <input type="date" name="asOf" defaultValue={body.asOf} className={CONTROL} />
          </label>
          <button
            type="submit"
            className="rounded bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            조회
          </button>
        </form>
      </header>

      <p className="mb-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        {body.notice}
      </p>

      <section
        aria-label={`${body.asOf} 기준 현재 상태`}
        className="mb-5 rounded border border-zinc-200 px-4 py-3 dark:border-zinc-800"
      >
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          <time dateTime={body.asOf}>{body.asOf}</time> 기준 상태
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-3">
          <span className="text-lg">
            <StatusBadge status={body.status} leaveType={body.leaveType} />
          </span>
          <span className="text-sm">부서: {body.dept ?? "-"}</span>
        </p>
      </section>

      {body.warnings.length > 0 && (
        <section
          id="warnings"
          aria-label="확인이 필요한 기록"
          className="mb-5 scroll-mt-4 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <h2 className="mb-1 font-medium">
            <span aria-hidden="true">⚠ </span>확인이 필요한 기록 {body.warnings.length}건
          </h2>
          <p className="mb-2 text-xs">
            시스템이 임의로 고치지 않고, 사람이 확인하도록 표시한 기록입니다. 아래 타임라인에서
            &quot;확인 필요&quot; 표시가 붙은 기록을 살펴보세요.
          </p>
          <ul className="list-disc pl-5">
            {body.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="왜 이 상태인가">
        <h2 className="mb-1 text-base font-semibold">왜 이 상태인가</h2>
        <p className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">
          이 직원의 인사 기록을 날짜순으로 보여줍니다. &quot;근거&quot;는 {body.asOf}의 상태를 정하는 데
          쓰인 기록이고, &quot;적용 안 됨&quot;은 기준일보다 뒤에 효력이 생겨서 반영하지 않은 기록입니다.
        </p>
        <ol className="rounded border border-zinc-200 dark:border-zinc-800">
          {body.timeline.map((item) => (
            <li
              key={item.id}
              className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-zinc-200 px-3 py-2 text-sm first:border-t-0 dark:border-zinc-800 ${
                item.applied ? "" : "text-zinc-500 dark:text-zinc-500"
              } ${item.isEvidence ? "bg-emerald-50 dark:bg-emerald-950/40" : ""}`}
            >
              <time
                dateTime={item.effectiveDate}
                className="w-24 shrink-0 font-mono tabular-nums"
              >
                {item.effectiveDate}
              </time>
              <span className="min-w-0 flex-1">{describeEvent(item)}</span>
              <span className="flex gap-1 text-xs">
                {item.hasWarning && (
                  <span className="rounded bg-amber-200 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                    <span aria-hidden="true">⚠ </span>확인 필요
                  </span>
                )}
                {item.isEvidence && (
                  <span className="rounded bg-emerald-200 px-1.5 py-0.5 font-medium text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
                    근거
                  </span>
                )}
                {!item.applied && (
                  <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                    적용 안 됨
                  </span>
                )}
                {item.source === "auto" && (
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium text-sky-900 dark:bg-sky-950 dark:text-sky-200">
                    자동 생성
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function BackLink({ href }: { href: string }) {
  return (
    <p className="mb-3 text-sm">
      <Link href={href} className="underline underline-offset-2">
        ← 직원 목록
      </Link>
    </p>
  );
}
