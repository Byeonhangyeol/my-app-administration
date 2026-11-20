// 덩어리별 분석 결과(legacy/analysis/out)를 지시서 01단계의 문서 묶음으로 합칩니다.
// 만드는 것 (모두 legacy/docs/ 안, git 제외):
//   - business_rules_evidence.csv : 모든 규칙 CSV를 한 파일로 (덩어리 ID, 테스트ID 칸 추가)
//   - ambiguities_raw.md          : 모든 분석 문서의 "모호한 점"과 "지시서와 다른 부분"을 한곳에 모음
//   - coverage_report.md          : 계획한 줄 범위를 분석 문서가 읽었다고 적었는지 점검
//   - legacy_inventory.md         : 엑셀 3개 구조 인벤토리와 위 문서들의 목차
// 사용법: node scripts/merge-analysis.mjs

import fs from "node:fs";
import path from "node:path";

const root = path.resolve("legacy", "analysis");
const docs = path.resolve("legacy", "docs");
const plan = JSON.parse(fs.readFileSync(path.join(root, "_plan.json"), "utf8"));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}
const csvCell = (v) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// 1) 규칙 CSV 합치기
const outRows = [["규칙번호", "덩어리", "업무규칙", "근거파일", "모듈/함수(줄)", "확인수준", "앱 처리방식", "분류", "테스트ID"]];
let n = 0;
const bad = [];
for (const c of plan) {
  const f = path.join(root, "out", `${c.id}.rules.csv`);
  if (!fs.existsSync(f)) {
    bad.push(`${c.id}: CSV 없음`);
    continue;
  }
  const rows = parseCsv(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  for (const r of rows.slice(1)) {
    if (r.length !== 6) {
      bad.push(`${c.id}: 열 수 ${r.length} 인 줄 건너뜀`);
      continue;
    }
    n++;
    outRows.push([`R${String(n).padStart(4, "0")}`, c.id, r[0], r[1], r[2], r[3], r[4], r[5], ""]);
  }
}
fs.writeFileSync(path.join(docs, "business_rules_evidence.csv"), "﻿" + outRows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n", "utf8");

// 2) 모호한 점 모으기
const amb = ["# 모호한 점·충돌·의심 (덩어리별 원문 모음)", "", "각 분석 문서의 해당 절을 그대로 모은 것입니다. 중복과 분류는 `policy_decisions.md` 에서 정리합니다.", ""];
let ambChars = 0;
for (const c of plan) {
  const t = fs.readFileSync(path.join(root, "out", `${c.id}.md`), "utf8");
  const lines = t.split("\n");
  const picks = [];
  let mode = null;
  for (const line of lines) {
    if (/^##\s/.test(line)) mode = /모호한|충돌|의심/.test(line) ? "amb" : /지시서와/.test(line) ? "spec" : null;
    if (mode) picks.push(line);
  }
  if (picks.length) {
    amb.push(`## ${c.id} (${c.workbook})`, "", ...picks.map((l) => l.replace(/^##\s/, "### ")), "");
    ambChars += picks.join("\n").length;
  }
}
fs.writeFileSync(path.join(docs, "ambiguities_raw.md"), amb.join("\n"), "utf8");

// 3) 읽은 범위 점검: 계획한 모듈 이름이 분석 문서의 읽은 범위 확인표에 나오는지
const cov = ["# 읽은 범위 점검", "", "계획에서 배정한 모듈마다, 분석 문서의 '읽은 범위 확인표'에 그 모듈과 줄 범위가 적혀 있는지 확인한 결과입니다. 줄 번호가 정확히 일치하지 않아도(작업자가 더 읽은 경우) 모듈 이름과 끝 줄이 있으면 통과로 봅니다.", "", "| 덩어리 | 모듈 | 배정 줄 범위 | 확인표에 모듈 이름 | 확인표에 끝 줄 번호 |", "|---|---|---|---|---|"];
let missing = 0;
for (const c of plan) {
  const t = fs.readFileSync(path.join(root, "out", `${c.id}.md`), "utf8");
  const start = t.indexOf("읽은 범위");
  const table = start >= 0 ? t.slice(start, start + 6000) : "";
  for (const p of c.parts) {
    const hasName = table.includes(p.module) || t.slice(0, 8000).includes(p.module);
    const hasEnd = new RegExp(`(^|[^0-9])${p.endLine}([^0-9]|$)`).test(table);
    if (!hasName || !hasEnd) missing++;
    cov.push(`| ${c.id} | ${p.module} | ${p.startLine}-${p.endLine} | ${hasName ? "예" : "**아니오**"} | ${hasEnd ? "예" : "**아니오**"} |`);
  }
}
cov.push("", `확인표에서 모듈 이름이나 끝 줄이 확인되지 않은 항목: ${missing}개`);
fs.writeFileSync(path.join(docs, "coverage_report.md"), cov.join("\n"), "utf8");

// 4) 인벤토리 목차
const inv = ["# 레거시 인벤토리 (지시서 01단계)", "", "원본 엑셀 3개는 읽기 전용으로만 열었고 수정·저장하지 않았습니다. 이 폴더(legacy/)는 git에 올라가지 않습니다.", "", "## 문서 목록", ""];
inv.push("| 문서 | 내용 |", "|---|---|");
inv.push("| inventory-<파일>.md | 시트(숨김 포함), 표와 열, 정의된 이름, 연결, 버튼과 매크로, 설정 시트 값 |");
inv.push("| vba_call_graph.md | 프로시저 호출 관계, 시작점(버튼·이벤트) |");
inv.push("| queries/*.m.txt | 파워쿼리 M 코드 원문 |");
inv.push("| ../analysis/out/<덩어리>.md | 모듈별 상세 분석 40개 |");
inv.push("| business_rules_evidence.csv | 업무 규칙과 근거 (모든 덩어리 합본) |");
inv.push("| ambiguities_raw.md | 모호한 점 원문 모음 |");
inv.push("| coverage_report.md | 읽은 범위 점검 |", "");
for (const f of fs.readdirSync(docs).filter((x) => x.startsWith("inventory-") && x.endsWith(".md")).sort()) {
  inv.push("---", "", fs.readFileSync(path.join(docs, f), "utf8").replace(/^# /m, "## "), "");
}
fs.writeFileSync(path.join(docs, "legacy_inventory.md"), inv.join("\n"), "utf8");

console.log(`합친 규칙 ${n}개`);
if (bad.length) console.log("주의:\n" + bad.join("\n"));
console.log(`모호한 점 원문 ${Math.round(ambChars / 1000)}K자, 읽은 범위 미확인 ${missing}개`);
