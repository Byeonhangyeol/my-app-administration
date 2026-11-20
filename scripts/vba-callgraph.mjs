// 추출한 VBA 코드에서 "누가 누구를 부르는지"(호출 관계)를 자동으로 뽑습니다. (지시서 01단계 vba_call_graph)
// 입력: legacy/vba/<엑셀 이름>/ (extract-vba.mjs 결과), legacy/docs/inventory-*.json (버튼 연결 매크로)
// 출력: legacy/docs/vba_call_graph.md, legacy/docs/vba_call_graph.json
// 호출 판정: 같은 엑셀 안에서 프로시저 이름이 코드에 낱말로 나오면 호출로 봅니다(주석 제외).
//           문자열 안의 이름("OnAction", "Application.Run", "OnTime" 등)도 따로 표시합니다.
// 한계: 이름이 같은 프로시저가 모듈마다 있으면 구분하지 못하고 모두 후보로 적습니다.

import fs from "node:fs";
import path from "node:path";

const vbaRoot = path.resolve("legacy", "vba");
const docs = path.resolve("legacy", "docs");
const WORD = /[\p{L}\p{N}_]+/gu;
const PROC_RE = /^\s*(Public\s+|Private\s+|Friend\s+)?(Static\s+)?(Sub|Function|Property\s+(?:Get|Let|Set))\s+([\p{L}\p{N}_]+)/iu;
const EVENT_RE = /^(Workbook|Worksheet|Chart|Auto)_|^(Document|Form|UserForm)_/;

function stripComment(line) {
  // 문자열 밖의 ' 이후는 주석
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inStr = !inStr;
    else if (ch === "'" && !inStr) return line.slice(0, i);
  }
  return line;
}

const result = [];
for (const dir of fs.readdirSync(vbaRoot, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const meta = JSON.parse(fs.readFileSync(path.join(vbaRoot, dir.name, "_modules.json"), "utf8"));
  const procs = [];
  for (const m of meta.modules) {
    if (m.error || m.procedures.length === 0) continue;
    const ext = m.type === "procedural" ? "bas" : "cls";
    const safe = m.name.replace(/[\\/:*?"<>|]/g, "_");
    const lines = fs.readFileSync(path.join(vbaRoot, dir.name, `${safe}.${ext}.txt`), "utf8").split("\n");
    m.procedures.forEach((p, i) => {
      const end = (m.procedures[i + 1]?.line ?? lines.length + 1) - 1;
      procs.push({ module: m.name, name: p.name, kind: p.kind, scope: p.scope, line: p.line, end, body: lines.slice(p.line - 1, end), isDocModule: m.type !== "procedural" });
    });
  }
  const byName = new Map();
  for (const p of procs) (byName.get(p.name.toLowerCase()) ?? byName.set(p.name.toLowerCase(), []).get(p.name.toLowerCase())).push(p);

  const edges = [];
  const stringRefs = [];
  const calledBy = new Map();
  for (const p of procs) {
    const callees = new Set();
    p.body.forEach((raw, idx) => {
      if (idx === 0) {
        // 선언 줄에서 자기 이름은 제외
      }
      const code = stripComment(raw);
      // 문자열 안 이름 (OnAction, Run, OnTime 등)
      for (const s of code.match(/"[^"]*"/g) ?? []) {
        const inner = s.slice(1, -1).replace(/^.*!/, "").replace(/\(.*$/, "").trim();
        if (byName.has(inner.toLowerCase()) && /OnAction|\.Run|OnTime|Application\.Run/i.test(code)) stringRefs.push({ from: `${p.module}.${p.name}`, to: inner, line: p.line + idx });
      }
      const noStr = code.replace(/"[^"]*"/g, '""');
      for (const w of noStr.match(WORD) ?? []) {
        const key = w.toLowerCase();
        if (!byName.has(key)) continue;
        if (idx === 0 && key === p.name.toLowerCase()) continue;
        if (key === p.name.toLowerCase() && PROC_RE.test(raw)) continue;
        callees.add(key);
      }
    });
    for (const k of callees) {
      for (const target of byName.get(k)) {
        edges.push({ from: `${p.module}.${p.name}`, to: `${target.module}.${target.name}`, recursive: target === p });
        calledBy.set(`${target.module}.${target.name}`, (calledBy.get(`${target.module}.${target.name}`) ?? 0) + (target === p ? 0 : 1));
      }
    }
  }
  for (const s of stringRefs) for (const t of byName.get(s.to.toLowerCase())) calledBy.set(`${t.module}.${t.name}`, (calledBy.get(`${t.module}.${t.name}`) ?? 0) + 1);

  // 버튼에 연결된 매크로
  const invPath = path.join(docs, `inventory-${dir.name}.json`);
  const buttons = fs.existsSync(invPath) ? JSON.parse(fs.readFileSync(invPath, "utf8")).buttons : [];
  const buttonMacros = new Set(buttons.map((b) => b.macro.replace(/^.*!/, "").toLowerCase()));

  const roots = procs.filter((p) => {
    const id = `${p.module}.${p.name}`;
    const uncalled = (calledBy.get(id) ?? 0) === 0;
    return uncalled && (p.scope !== "Private" || EVENT_RE.test(p.name) || p.isDocModule);
  });
  result.push({ workbook: dir.name, procs, edges, stringRefs, calledBy, buttons, buttonMacros, roots });
}

fs.mkdirSync(docs, { recursive: true });
const md = [];
for (const r of result) {
  md.push(`# 호출 관계 — ${r.workbook}`, "", `- 프로시저 ${r.procs.length}개, 호출 관계 ${r.edges.length}개, 문자열로 지정된 호출 ${r.stringRefs.length}개, 버튼 연결 매크로 ${r.buttonMacros.size}개`, "");
  md.push("## 시작점(아무도 부르지 않는 Public 프로시저, 이벤트, 버튼 연결)", "");
  md.push("| 모듈 | 프로시저 | 종류 | 줄 | 버튼 연결 | 이벤트 |", "|---|---|---|---|---|---|");
  for (const p of r.roots) md.push(`| ${p.module} | ${p.name} | ${p.kind} | ${p.line}-${p.end} | ${r.buttonMacros.has(p.name.toLowerCase()) ? "예" : ""} | ${EVENT_RE.test(p.name) ? "예" : ""} |`);
  const btnOnly = [...r.buttonMacros].filter((m) => !r.procs.some((p) => p.name.toLowerCase() === m));
  if (btnOnly.length) md.push("", `버튼에 연결됐지만 코드에서 찾지 못한 매크로 이름: ${btnOnly.join(", ")}`);
  md.push("", "## 모듈별 호출 목록 (프로시저 → 부르는 대상)", "");
  const mods = [...new Set(r.procs.map((p) => p.module))];
  for (const m of mods) {
    md.push(`### ${m}`, "");
    for (const p of r.procs.filter((x) => x.module === m)) {
      const id = `${p.module}.${p.name}`;
      const out = r.edges.filter((e) => e.from === id && !e.recursive).map((e) => (e.to.startsWith(`${m}.`) ? e.to.slice(m.length + 1) : e.to));
      const uniq = [...new Set(out)];
      md.push(`- **${p.name}** (${p.scope}, ${p.line}-${p.end}, 불리는 횟수 ${r.calledBy.get(id) ?? 0})${uniq.length ? " → " + uniq.join(", ") : ""}`);
    }
    md.push("");
  }
  if (r.stringRefs.length) {
    md.push("## 문자열로 지정된 호출 (OnAction / Application.Run / OnTime)", "");
    for (const s of r.stringRefs) md.push(`- ${s.from} → ${s.to} (줄 ${s.line})`);
    md.push("");
  }
}
fs.writeFileSync(path.join(docs, "vba_call_graph.md"), md.join("\n"), "utf8");
fs.writeFileSync(path.join(docs, "vba_call_graph.json"), JSON.stringify(result.map((r) => ({ workbook: r.workbook, procs: r.procs.map(({ body, ...p }) => p), edges: r.edges, stringRefs: r.stringRefs, roots: r.roots.map((p) => `${p.module}.${p.name}`) })), null, 2), "utf8");
for (const r of result) console.log(`${r.workbook}: 프로시저 ${r.procs.length}, 호출 ${r.edges.length}, 문자열 호출 ${r.stringRefs.length}, 시작점 ${r.roots.length}, 버튼 매크로 ${r.buttonMacros.size}`);
