// 엑셀(.xlsm)의 구조를 읽기 전용으로 점검해 "비식별 인벤토리"를 만듭니다. (지시서 01단계)
// - 시트 목록과 숨김 상태, 표(열 이름), 정의된 이름, 외부 연결, 파워쿼리(M 코드), 버튼과 연결된 매크로를 모읍니다.
// - 직원 정보가 들어 있는 셀 값은 읽지 않습니다. 읽는 값은 설정 시트(기준설정 등)의 앞쪽 몇 칸뿐입니다.
// - 원본은 수정하지 않습니다. 결과는 git에 올라가지 않는 legacy/docs/ 에 저장합니다.
// 사용법: node scripts/audit-legacy.mjs <xlsm> [<xlsm> ...]   (jszip 필요, NODE_PATH로 지정)

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"') : null;
};
const tags = (xml, name) => xml.match(new RegExp(`<${name}\\b[^>]*?(?:/>|>)`, "g")) ?? [];

async function text(zip, p) {
  const f = zip.file(p);
  return f ? await f.async("string") : null;
}

function parseRels(xml) {
  const map = {};
  for (const t of tags(xml ?? "", "Relationship")) map[attr(t, "Id")] = { target: attr(t, "Target"), type: attr(t, "Type") };
  return map;
}
const resolve = (base, target) => {
  if (target.startsWith("/")) return target.slice(1);
  return path.posix.normalize(path.posix.join(path.posix.dirname(base), target));
};

/** 파워쿼리 DataMashup(customXml)에서 M 코드를 꺼냅니다. */
async function extractMashup(zip) {
  const out = [];
  for (const name of Object.keys(zip.files)) {
    if (!/^customXml\/item\d+\.xml$/.test(name)) continue;
    // UTF-16 으로 저장된 경우가 있어 바이트를 보고 글자 방식을 정합니다.
    const bytes = await zip.file(name).async("nodebuffer");
    const s = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString("utf16le") : bytes.toString("utf8");
    if (!s.includes("DataMashup")) continue;
    const b64 = />([A-Za-z0-9+/=\s]+)<\/DataMashup>/.exec(s)?.[1]?.replace(/\s/g, "");
    if (!b64) continue;
    const buf = Buffer.from(b64, "base64");
    const pkgSize = buf.readUInt32LE(4);
    const pkg = buf.subarray(8, 8 + pkgSize);
    const inner = await JSZip.loadAsync(pkg);
    const section = inner.file("Formulas/Section1.m");
    if (section) out.push(await section.async("string"));
  }
  return out;
}

async function audit(file) {
  const raw = fs.readFileSync(file);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const zip = await JSZip.loadAsync(raw);
  const base = path.basename(file, path.extname(file));
  const wb = await text(zip, "xl/workbook.xml");
  const wbRels = parseRels(await text(zip, "xl/_rels/workbook.xml.rels"));
  const sst = await text(zip, "xl/sharedStrings.xml");
  const sharedStrings = sst ? (sst.match(/<si>[\s\S]*?<\/si>/g) ?? []).map((si) => (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")) : [];

  const info = { file: path.basename(file), sha256, sheets: [], definedNames: [], tables: [], buttons: [], connections: [], externalLinks: [], settingsCells: [], queries: [] };
  info.workbookCodeName = attr(tags(wb, "workbookPr")[0] ?? "", "codeName");
  info.calc = tags(wb, "calcPr")[0] ?? null;

  for (const t of tags(wb, "definedName")) {
    const name = attr(t, "name");
    const m = new RegExp(`<definedName\\b[^>]*name="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*)<`).exec(wb);
    info.definedNames.push({ name, hidden: attr(t, "hidden") === "1", ref: (m?.[1] ?? "").slice(0, 160) });
  }

  for (const t of tags(wb, "sheet")) {
    const rid = attr(t, "r:id");
    const sheetPath = resolve("xl/workbook.xml", wbRels[rid].target);
    const xml = await text(zip, sheetPath);
    const relPath = sheetPath.replace("worksheets/", "worksheets/_rels/") + ".rels";
    const rels = parseRels(await text(zip, relPath));
    const s = {
      name: attr(t, "name"),
      state: attr(t, "state") ?? "visible",
      path: sheetPath,
      codeName: attr(tags(xml, "sheetPr")[0] ?? "", "codeName"),
      dimension: attr(tags(xml, "dimension")[0] ?? "", "ref"),
      formulas: (xml.match(/<f[ >]/g) ?? []).length,
      conditionalFormats: (xml.match(/<conditionalFormatting\b/g) ?? []).length,
      dataValidations: attr(tags(xml, "dataValidations")[0] ?? "", "count"),
      mergedCells: attr(tags(xml, "mergeCells")[0] ?? "", "count"),
      tableParts: (xml.match(/<tablePart\b/g) ?? []).length,
      protected: /<sheetProtection\b/.test(xml),
      hyperlinks: (xml.match(/<hyperlink\b/g) ?? []).length,
      drawings: [],
    };
    info.sheets.push(s);

    // 설정 시트: 앞쪽 몇 칸의 값만 읽음 (기준일 같은 설정 값)
    if (/기준설정|기준일값쿼리/.test(s.name)) {
      for (const c of xml.match(/<c\b[^>]*r="[A-D](?:[1-9]|10)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const ref = attr(c, "r");
        const tt = attr(c, "t");
        const v = /<v>([^<]*)<\/v>/.exec(c)?.[1];
        const f = /<f[^>]*>([^<]*)<\/f>/.exec(c)?.[1];
        if (v === undefined && !f) continue;
        info.settingsCells.push({ sheet: s.name, cell: ref, type: tt ?? "n", value: tt === "s" ? sharedStrings[Number(v)] : v, formula: f ?? null });
      }
    }

    // 버튼과 연결된 매크로 (도형, 양식 컨트롤)
    for (const r of Object.values(rels)) {
      if (r.type.endsWith("/drawing")) {
        const dp = resolve(sheetPath, r.target);
        const dxml = await text(zip, dp);
        if (!dxml) continue;
        s.drawings.push(dp);
        for (const sp of dxml.match(/<xdr:(?:sp|pic|graphicFrame|cxnSp)\b[\s\S]*?<\/xdr:(?:sp|pic|graphicFrame|cxnSp)>/g) ?? []) {
          const macro = attr(sp, "macro");
          if (!macro) continue;
          const label = (sp.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, "")).join(" ").trim();
          const nm = attr(/<xdr:cNvPr\b[^>]*>/.exec(sp)?.[0] ?? "", "name");
          info.buttons.push({ sheet: s.name, shape: nm, label, macro });
        }
      }
      if (r.type.endsWith("/vmlDrawing")) {
        const vp = resolve(sheetPath, r.target);
        const vxml = await text(zip, vp);
        for (const m of (vxml ?? "").matchAll(/<x:FmlaMacro>([^<]*)<\/x:FmlaMacro>/g)) info.buttons.push({ sheet: s.name, shape: "양식 컨트롤", label: "", macro: m[1] });
      }
    }
  }

  for (const name of Object.keys(zip.files).filter((n) => /^xl\/tables\/table\d+\.xml$/.test(n))) {
    const x = await text(zip, name);
    const head = /<table\b[^>]*>/.exec(x)[0];
    info.tables.push({
      name: attr(head, "displayName"),
      ref: attr(head, "ref"),
      columns: (x.match(/<tableColumn\b[^>]*>/g) ?? []).map((c) => attr(c, "name")),
      hasQuery: /queryTableFields|connectionId/.test(x) || /<queryTable/.test(x),
    });
  }
  const conn = await text(zip, "xl/connections.xml");
  for (const t of tags(conn ?? "", "connection")) info.connections.push({ name: attr(t, "name"), type: attr(t, "type"), description: attr(t, "description"), refreshOnLoad: attr(t, "refreshOnLoad"), background: attr(t, "background") });
  for (const name of Object.keys(zip.files).filter((n) => /^xl\/externalLinks\/externalLink\d+\.xml$/.test(n))) info.externalLinks.push(name);
  info.queries = await extractMashup(zip);
  info.parts = Object.keys(zip.files).length;
  return info;
}

function toMarkdown(i, q) {
  const L = [];
  L.push(`# ${i.file} — 구조 인벤토리`, "", `- SHA256: \`${i.sha256}\``, `- 시트 ${i.sheets.length}개 (숨김 ${i.sheets.filter((s) => s.state !== "visible").length}개), 표 ${i.tables.length}개, 정의된 이름 ${i.definedNames.length}개, 연결 ${i.connections.length}개, 외부 링크 ${i.externalLinks.length}개, 버튼·컨트롤 ${i.buttons.length}개, 파워쿼리 ${q}개 파일`, `- 통합 문서 코드 이름: ${i.workbookCodeName ?? "-"}`, `- 계산 설정: \`${i.calc ?? "-"}\``, "");
  L.push("## 시트", "", "| 번호 | 시트 이름 | 코드 이름 | 상태 | 영역 | 수식 | 조건부 서식 | 병합 | 유효성 | 표 | 보호 |", "|---|---|---|---|---|---|---|---|---|---|---|");
  i.sheets.forEach((s, n) => L.push(`| ${n + 1} | ${s.name} | ${s.codeName ?? ""} | ${s.state} | ${s.dimension ?? ""} | ${s.formulas} | ${s.conditionalFormats} | ${s.mergedCells ?? 0} | ${s.dataValidations ?? 0} | ${s.tableParts} | ${s.protected ? "예" : ""} |`));
  L.push("", "## 버튼·도형과 연결된 매크로", "");
  if (i.buttons.length === 0) L.push("(없음)");
  else {
    L.push("| 시트 | 도형 이름 | 표시 글자 | 연결된 매크로 |", "|---|---|---|---|");
    for (const b of i.buttons) L.push(`| ${b.sheet} | ${b.shape} | ${b.label} | ${b.macro} |`);
  }
  L.push("", "## 표(ListObject)와 열", "");
  for (const t of i.tables) L.push(`- **${t.name}** \`${t.ref}\` ${t.hasQuery ? "(쿼리 연결)" : ""}: ${t.columns.join(", ")}`);
  L.push("", "## 정의된 이름", "");
  for (const d of i.definedNames) L.push(`- ${d.name}${d.hidden ? " (숨김)" : ""}: \`${d.ref}\``);
  L.push("", "## 데이터 연결·외부 링크·파워쿼리", "");
  if (i.connections.length === 0 && i.externalLinks.length === 0 && i.queries.length === 0) L.push("(없음)");
  for (const c of i.connections) L.push(`- 연결 **${c.name}** (type ${c.type}) ${c.description ?? ""} 열 때 새로고침=${c.refreshOnLoad ?? "-"}`);
  for (const e of i.externalLinks) L.push(`- 외부 링크 ${e}`);
  for (const [n, m] of i.queries.entries()) L.push(`- 파워쿼리 M 코드 ${n + 1}: ${m.split("\n").length}줄 (legacy/docs/queries/ 에 저장)`);
  L.push("", "## 설정 시트의 값 (기준일 등, 앞쪽 칸만)", "");
  if (i.settingsCells.length === 0) L.push("(없음)");
  for (const c of i.settingsCells) L.push(`- ${c.sheet}!${c.cell} = ${c.value ?? ""}${c.formula ? ` (수식: ${c.formula})` : ""}`);
  return L.join("\n");
}

const files = process.argv.slice(2);
const outDir = path.resolve("legacy", "docs");
fs.mkdirSync(path.join(outDir, "queries"), { recursive: true });
const all = [];
for (const f of files) {
  const info = await audit(f);
  const base = path.basename(f, path.extname(f));
  info.queries.forEach((m, n) => fs.writeFileSync(path.join(outDir, "queries", `${base}-${n + 1}.m.txt`), m, "utf8"));
  const md = toMarkdown(info, info.queries.length);
  fs.writeFileSync(path.join(outDir, `inventory-${base}.md`), md, "utf8");
  fs.writeFileSync(path.join(outDir, `inventory-${base}.json`), JSON.stringify({ ...info, queries: info.queries.length }, null, 2), "utf8");
  all.push(info);
  console.log(`${info.file}: 시트 ${info.sheets.length}, 숨김 ${info.sheets.filter((s) => s.state !== "visible").length}, 표 ${info.tables.length}, 이름 ${info.definedNames.length}, 연결 ${info.connections.length}, 외부링크 ${info.externalLinks.length}, 버튼 ${info.buttons.length}, 쿼리 ${info.queries.length}, 설정값 ${info.settingsCells.length}칸`);
}
