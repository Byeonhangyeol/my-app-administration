// 엑셀(.xlsm) 안의 VBA 매크로 코드를 읽기 전용으로 꺼내는 스크립트입니다.
// - 원본 파일은 읽기만 하고 절대 수정·저장하지 않습니다. (원본 SHA256을 함께 기록합니다)
// - 셀 값(직원 정보)은 읽지 않고, VBA 프로젝트(vbaProject.bin)만 읽습니다.
// - 꺼낸 코드는 git에 올라가지 않는 legacy/ 폴더에만 저장합니다. (이 폴더는 .gitignore에 등록돼 있음)
//
// 사용법: node scripts/extract-vba.mjs <xlsm 파일> [<xlsm 파일> ...]
// 필요한 패키지: jszip, cfb (프로젝트에 설치하지 않고 NODE_PATH로 지정해서 씁니다)
//
// VBA 압축 해제와 dir 스트림 구조는 Microsoft [MS-OVBA] 문서의 방식을 따릅니다.

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const CFB = require("cfb");

const OUT_ROOT = path.resolve("legacy", "vba");

/** MS-OVBA 2.4.1 압축 해제. start 위치의 첫 바이트는 반드시 0x01 */
function decompress(buf, start = 0) {
  if (buf[start] !== 0x01) throw new Error("VBA 압축 시그니처(0x01)가 아닙니다");
  const out = [];
  let pos = start + 1;
  while (pos + 2 <= buf.length) {
    const header = buf[pos] | (buf[pos + 1] << 8);
    const chunkStart = pos;
    const size = (header & 0x0fff) + 3;
    const compressed = (header >> 15) & 1;
    const chunkEnd = Math.min(chunkStart + size, buf.length);
    pos += 2;
    const outChunkStart = out.length;
    if (!compressed) {
      for (let i = 0; i < 4096 && pos < buf.length; i++) out.push(buf[pos++]);
      continue;
    }
    while (pos < chunkEnd) {
      const flags = buf[pos++];
      for (let bit = 0; bit < 8 && pos < chunkEnd; bit++) {
        if (((flags >> bit) & 1) === 0) {
          out.push(buf[pos++]);
        } else {
          const token = buf[pos] | (buf[pos + 1] << 8);
          pos += 2;
          const diff = out.length - outChunkStart;
          const bitCount = Math.max(Math.ceil(Math.log2(Math.max(diff, 1))), 4);
          const lenMask = 0xffff >> bitCount;
          const offMask = ~lenMask & 0xffff;
          const length = (token & lenMask) + 3;
          const offset = ((token & offMask) >> (16 - bitCount)) + 1;
          for (let i = 0; i < length; i++) out.push(out[out.length - offset]);
        }
      }
    }
  }
  return Buffer.from(out);
}

const u16 = (b, p) => b[p] | (b[p + 1] << 8);
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0;

function codepageToLabel(cp) {
  if (cp === 949) return "euc-kr";
  if (cp === 65001) return "utf-8";
  if (cp === 1252) return "windows-1252";
  return `windows-${cp}`;
}

/** dir 스트림에서 코드 페이지와 모듈 목록을 읽습니다. (참조 목록은 건너뛰고 모듈 이름 기록을 찾아서 읽음) */
function parseDir(dir) {
  let codepage = 949;
  let p = 0;
  for (let i = 0; i < 4 && p < dir.length; i++) {
    const id = u16(dir, p);
    const size = u32(dir, p + 2);
    if (id === 0x0003) codepage = u16(dir, p + 6);
    p += 6 + size;
  }
  const modules = [];
  for (let pos = 0; pos + 8 < dir.length; pos++) {
    if (u16(dir, pos) !== 0x0019) continue;
    const nameSize = u32(dir, pos + 2);
    const next = pos + 6 + nameSize;
    if (nameSize === 0 || nameSize > 200 || next + 2 > dir.length || u16(dir, next) !== 0x0047) continue;
    const mod = { nameBytes: dir.subarray(pos + 6, next), streamName: null, offset: 0, type: "procedural" };
    let q = pos + 6 + nameSize;
    while (q + 6 <= dir.length) {
      const id = u16(dir, q);
      const size = u32(dir, q + 2);
      const data = dir.subarray(q + 6, q + 6 + size);
      if (id === 0x001a) mod.streamNameBytes = data;
      if (id === 0x0031) mod.offset = u32(dir, q + 6);
      if (id === 0x0021) mod.type = "procedural";
      if (id === 0x0022) mod.type = "document/class";
      q += 6 + size;
      if (id === 0x002b) break;
    }
    modules.push(mod);
    pos = q - 1;
  }
  return { codepage, modules };
}

const PROC_RE = /^\s*(Public\s+|Private\s+|Friend\s+)?(Static\s+)?(Sub|Function|Property\s+(?:Get|Let|Set))\s+([\p{L}\p{N}_]+)/iu;

async function extract(file) {
  const raw = fs.readFileSync(file); // 읽기 전용
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const zip = await JSZip.loadAsync(raw);
  const entry = zip.file("xl/vbaProject.bin");
  if (!entry) return { file, sha256, error: "vbaProject.bin 없음 (매크로 없는 파일)" };
  const bin = Buffer.from(await entry.async("uint8array"));
  const cfb = CFB.read(bin, { type: "buffer" });
  const dirEntry = CFB.find(cfb, "/VBA/dir");
  const dir = decompress(Buffer.from(dirEntry.content));
  const { codepage, modules } = parseDir(dir);
  const decoder = new TextDecoder(codepageToLabel(codepage));

  const base = path.basename(file, path.extname(file));
  const outDir = path.join(OUT_ROOT, base);
  fs.mkdirSync(outDir, { recursive: true });

  const summary = [];
  for (const m of modules) {
    const name = decoder.decode(m.nameBytes);
    const streamName = decoder.decode(m.streamNameBytes ?? m.nameBytes);
    const stream = CFB.find(cfb, `/VBA/${streamName}`);
    if (!stream) {
      summary.push({ name, error: "모듈 스트림을 찾지 못함" });
      continue;
    }
    let text;
    try {
      text = decoder.decode(decompress(Buffer.from(stream.content), m.offset));
    } catch (e) {
      summary.push({ name, error: `압축 해제 실패: ${e.message}` });
      continue;
    }
    text = text.replace(/\r\n/g, "\n");
    const safe = name.replace(/[\\/:*?"<>|]/g, "_");
    const ext = m.type === "procedural" ? "bas" : "cls";
    fs.writeFileSync(path.join(outDir, `${safe}.${ext}.txt`), text, "utf8");
    const lines = text.split("\n");
    const procs = [];
    lines.forEach((line, i) => {
      const mt = PROC_RE.exec(line);
      if (mt) procs.push({ kind: mt[3].replace(/\s+/g, " "), name: mt[4], scope: (mt[1] ?? "").trim() || "Public(기본)", line: i + 1 });
    });
    summary.push({ name, type: m.type, lines: lines.length, chars: text.length, procedures: procs });
  }
  fs.writeFileSync(
    path.join(outDir, "_modules.json"),
    JSON.stringify({ file: path.basename(file), sha256, codepage, modules: summary }, null, 2),
    "utf8",
  );
  return { file, sha256, codepage, binBytes: bin.length, dirBytes: dir.length, outDir, modules: summary };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("사용법: node scripts/extract-vba.mjs <xlsm 파일> ...");
  process.exit(1);
}
for (const f of files) {
  const r = await extract(f);
  console.log(`\n===== ${path.basename(f)}`);
  console.log(`SHA256 ${r.sha256}`);
  if (r.error) {
    console.log(r.error);
    continue;
  }
  const ok = r.modules.filter((m) => !m.error);
  const totalLines = ok.reduce((a, m) => a + m.lines, 0);
  const totalProcs = ok.reduce((a, m) => a + m.procedures.length, 0);
  console.log(`코드 페이지 ${r.codepage}, vbaProject.bin ${r.binBytes}바이트, 모듈 ${r.modules.length}개(성공 ${ok.length}), 총 ${totalLines}줄, 프로시저 ${totalProcs}개`);
  for (const m of r.modules) {
    if (m.error) console.log(`  [실패] ${m.name}: ${m.error}`);
    else console.log(`  ${m.type === "procedural" ? "모듈  " : "클래스"} ${m.name.padEnd(28)} ${String(m.lines).padStart(6)}줄 ${String(m.chars).padStart(8)}자 프로시저 ${m.procedures.length}`);
  }
}
