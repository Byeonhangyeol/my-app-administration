// 추출한 VBA 코드를 "한 명이 읽기 좋은 크기"의 덩어리로 나눕니다. (모듈·프로시저 경계에서만 자름)
// 입력: legacy/vba/<엑셀 이름>/_modules.json 과 모듈 텍스트
// 출력: legacy/analysis/_plan.json (읽을 파일, 줄 범위, 글자 수)
// 사용법: node scripts/plan-analysis.mjs [덩어리당 최대 글자 수]

import fs from "node:fs";
import path from "node:path";

const LIMIT = Number(process.argv[2] ?? 90000);
const root = path.resolve("legacy", "vba");
const chunks = [];

for (const dir of fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const meta = JSON.parse(fs.readFileSync(path.join(root, dir.name, "_modules.json"), "utf8"));
  const parts = [];
  for (const m of meta.modules) {
    if (m.error) continue;
    const ext = m.type === "procedural" ? "bas" : "cls";
    const safe = m.name.replace(/[\\/:*?"<>|]/g, "_");
    const file = path.join("legacy", "vba", dir.name, `${safe}.${ext}.txt`);
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split("\n");
    // 프로시저가 하나도 없고 40줄 이하인 모듈(빈 시트 모듈 등)은 읽을 코드가 없으므로 제외
    if (m.procedures.length === 0 && lines.length <= 40) continue;
    const cum = [0];
    for (const l of lines) cum.push(cum[cum.length - 1] + l.length + 1);
    const starts = m.procedures.map((p) => p.line);
    const total = cum[lines.length];
    if (total <= LIMIT) {
      parts.push({ file, module: m.name, startLine: 1, endLine: lines.length, chars: total });
      continue;
    }
    // 큰 모듈은 프로시저 시작 줄에서 잘라서 여러 부분으로
    let from = 1;
    while (from <= lines.length) {
      let to = lines.length;
      if (cum[lines.length] - cum[from - 1] > LIMIT) {
        // LIMIT 안에서 가장 뒤에 있는 프로시저 시작 줄 바로 앞까지
        let cut = -1;
        for (const s of starts) if (s > from && cum[s - 1] - cum[from - 1] <= LIMIT) cut = s - 1;
        if (cut === -1) {
          // 프로시저 하나가 LIMIT보다 크면 줄 단위로 자름
          cut = from;
          while (cut < lines.length && cum[cut + 1] - cum[from - 1] <= LIMIT) cut++;
        }
        to = cut;
      }
      parts.push({ file, module: m.name, startLine: from, endLine: to, chars: cum[to] - cum[from - 1] });
      from = to + 1;
    }
  }
  // 작은 부분은 같은 엑셀 안에서 이어 붙여 LIMIT 근처까지 묶음
  parts.sort((a, b) => b.chars - a.chars);
  const groups = [];
  for (const p of parts) {
    const g = groups.find((x) => x.chars + p.chars <= LIMIT);
    if (g) {
      g.parts.push(p);
      g.chars += p.chars;
    } else groups.push({ parts: [p], chars: p.chars });
  }
  groups.sort((a, b) => a.parts[0].module.localeCompare(b.parts[0].module));
  groups.forEach((g, i) => {
    chunks.push({
      id: `${dir.name.includes("서무") ? "B" : dir.name.includes("배치표") ? "C" : "A"}${String(i + 1).padStart(2, "0")}`,
      workbook: dir.name,
      chars: g.chars,
      lines: g.parts.reduce((a, p) => a + (p.endLine - p.startLine + 1), 0),
      parts: g.parts,
    });
  });
}

fs.mkdirSync(path.resolve("legacy", "analysis"), { recursive: true });
fs.writeFileSync(path.resolve("legacy", "analysis", "_plan.json"), JSON.stringify(chunks, null, 2), "utf8");
const byBook = {};
for (const c of chunks) (byBook[c.workbook] ??= []).push(c);
for (const [b, cs] of Object.entries(byBook)) {
  console.log(`\n[${b}] 덩어리 ${cs.length}개, 합계 ${cs.reduce((a, c) => a + c.chars, 0)}자, ${cs.reduce((a, c) => a + c.lines, 0)}줄`);
  for (const c of cs) console.log(`  ${c.id}  ${String(c.chars).padStart(7)}자 ${String(c.lines).padStart(6)}줄  ${c.parts.map((p) => `${p.module}[${p.startLine}-${p.endLine}]`).join(", ")}`);
}
console.log(`\n전체 덩어리 ${chunks.length}개, 합계 ${chunks.reduce((a, c) => a + c.chars, 0)}자`);
