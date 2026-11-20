// legacy/analysis/out/ 의 분석 결과물이 온전한지 검사합니다.
// - md: 필수 제목이 모두 있는지, 끝이 잘리지 않았는지
// - rules.csv: 머리글과 6개 열이 맞는지, 빈 칸이 있는 줄이 없는지
// 사용법: node scripts/check-analysis.mjs

import fs from "node:fs";
import path from "node:path";

const root = path.resolve("legacy", "analysis");
const plan = JSON.parse(fs.readFileSync(path.join(root, "_plan.json"), "utf8"));
const HEADER = "업무규칙,근거파일,모듈/함수(줄),확인수준,앱 처리방식,분류";

/** 따옴표를 지키며 CSV를 줄 단위 필드로 나눕니다. */
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
  return { rows, unclosedQuote: q };
}

const status = {};
for (const c of plan) {
  const md = path.join(root, "out", `${c.id}.md`);
  const csv = path.join(root, "out", `${c.id}.rules.csv`);
  const s = { id: c.id, md: "없음", csv: "없음", notes: [] };
  if (fs.existsSync(md)) {
    const t = fs.readFileSync(md, "utf8");
    const has = (k) => t.includes(k);
    const miss = ["읽은 범위", "모호한"].filter((k) => !has(k));
    const lines = t.split("\n").length;
    s.md = miss.length === 0 ? `온전(${lines}줄)` : `불완전(없는 제목: ${miss.join(", ")}, ${lines}줄)`;
    if (/[^\n]\n?$/.test(t) && !/\n$/.test(t)) s.notes.push("md 끝에 줄바꿈이 없음(잘렸을 수 있음)");
  }
  if (fs.existsSync(csv)) {
    const raw = fs.readFileSync(csv, "utf8").replace(/^﻿/, "");
    const { rows, unclosedQuote } = parseCsv(raw);
    const header = rows[0]?.join(",");
    const bad = rows.slice(1).filter((r) => r.length !== 6);
    const emptyField = rows.slice(1).filter((r) => r.length === 6 && (r[3] === "" || r[5] === ""));
    s.csv = `${rows.length - 1}개 규칙`;
    if (header !== HEADER) s.notes.push(`머리글 다름: ${header}`);
    if (bad.length) s.notes.push(`열 수가 6이 아닌 줄 ${bad.length}개`);
    if (emptyField.length) s.notes.push(`확인수준/분류가 빈 줄 ${emptyField.length}개`);
    if (unclosedQuote) s.notes.push("따옴표가 닫히지 않음(끝이 잘림)");
  }
  status[c.id] = s;
}
let ok = 0;
for (const s of Object.values(status)) {
  const good = s.md.startsWith("온전") && s.csv.endsWith("규칙") && s.notes.length === 0;
  if (good) ok++;
  console.log(`${good ? "OK  " : "점검"} ${s.id.padEnd(4)} md=${s.md.padEnd(28)} csv=${s.csv.padEnd(10)} ${s.notes.join("; ")}`);
}
console.log(`\n온전한 덩어리 ${ok} / ${plan.length}`);
