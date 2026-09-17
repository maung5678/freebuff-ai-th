#!/usr/bin/env node
/**
 * extract-orchestrator-strings.js — ดึงข้อความ UI ที่อยู่ใน orchestrator.js (ไม่ใช่บันเดิล UI)
 *
 * ทำไมต้องมี
 *   ข้อความบางกลุ่ม "ไม่เคยอยู่ในบันเดิล React" แต่ผู้ใช้เห็นจริง เช่น
 *     • ทูลทิปของชิปในแท็บสกิล (ชื่อสกิล + คำอธิบาย) — UI ประกอบข้อความจากข้อมูลที่ orchestrator ส่งมา
 *     • ข้อความ error ของระบบสกิล (ตอนบันทึก/ติดตั้ง/คืนค่า)
 *   extract-strings.js จึงมองไม่เห็นกลุ่มนี้ → gap-report/check-dict รายงาน "0 คำค้าง" ทั้งที่หน้าจอยังเป็นอังกฤษ
 *
 * ใช้:
 *   node fbth/tools/extract-orchestrator-strings.js                 # สรุปให้ดู
 *   node fbth/tools/extract-orchestrator-strings.js --list          # ไล่ทุกข้อความ
 *   node fbth/tools/extract-orchestrator-strings.js --json fbth/dict/candidates-orchestrator.json
 *   node fbth/tools/extract-orchestrator-strings.js <orchestrator.js>
 *
 * ตรวจสอบได้: check-dict.js เรียก collectOrchestratorUiStrings() จากไฟล์นี้ เพื่อยืนยันว่าทุกคีย์
 *            ที่เราเพิ่มยังตรงกับข้อความจริงในแอพ (คีย์ตายจะถูกจับได้)
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { autoFindBundles } = require('./extract-strings.js')

// ── ตัวอ่าน literal ของ JS (ใช้เฉพาะสตริง ไม่รันโค้ดของแอพ) ────────────────────

/** หาจุดเริ่ม/จบของบล็อก (เข้าใจสตริง/เทมเพลต/คอมเมนต์) */
function readBlock(src, openIndex) {
  let i = openIndex
  let depth = 0
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i) - 1
      continue
    }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue }
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') { depth--; if (depth === 0) return src.slice(openIndex, i + 1) }
  }
  return src.slice(openIndex)
}

/** คืน index ถัดจากเครื่องหมายปิดของสตริงที่เริ่มที่ i (คืนค่า i เดิมถ้าไม่ใช่สตริง) */
function skipString(src, i) {
  const q = src[i]
  if (q !== '"' && q !== "'" && q !== '`') return i
  i++
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') { i += 2; continue }
    if (q === '`' && c === '$' && src[i + 1] === '{') return i // เทมเพลตที่มีตัวแปร → ให้ผู้เรียกจัดการ
    if (c === q) return i + 1
    i++
  }
  return src.length
}

/** ถอดรหัสสตริง JS (รองรับ \n \t \uXXXX \u{...} \xXX และการต่อบรรทัดด้วย \) */
function decodeJsString(raw) {
  const body = raw.slice(1, -1)
  let out = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c !== '\\') { out += c; continue }
    const n = body[++i]
    switch (n) {
      case 'n': out += '\n'; break
      case 't': out += '\t'; break
      case 'r': out += '\r'; break
      case 'b': out += '\b'; break
      case 'f': out += '\f'; break
      case 'v': out += '\v'; break
      case '0': out += '\0'; break
      case 'x': out += String.fromCharCode(parseInt(body.substr(i + 1, 2), 16)); i += 2; break
      case 'u':
        if (body[i + 1] === '{') {
          const e = body.indexOf('}', i)
          out += String.fromCodePoint(parseInt(body.slice(i + 2, e), 16))
          i = e
        } else {
          out += String.fromCharCode(parseInt(body.substr(i + 1, 4), 16))
          i += 4
        }
        break
      case '\n': break
      case '\r': if (body[i + 1] === '\n') i++; break
      default: out += n
    }
  }
  return out
}

/**
 * ประเมินนิพจน์ที่เป็น "สตริงล้วน" (รองรับการต่อด้วย +)
 * คืน null ถ้าไม่ใช่ (เช่น มีเทมเพลตที่มี ${...} หรือชื่อตัวแปร)
 */
function evalStringExpr(expr) {
  const text = String(expr).trim()
  if (!text) return null
  let i = 0
  let out = ''
  let parts = 0
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++
    if (i >= text.length) break
    if (parts > 0) {
      if (text[i] !== '+') return null
      i++
      while (i < text.length && /\s/.test(text[i])) i++
    }
    const q = text[i]
    if (q !== '"' && q !== "'" && q !== '`') return null
    const end = skipString(text, i)
    if (end === i) return null
    const raw = text.slice(i, end)
    if (/[$]\\?\{/.test(raw)) return null // เทมเพลตที่มีตัวแปร
    out += decodeJsString(raw)
    parts++
    i = end
  }
  return parts ? out : null
}

/** แยก property ระดับบนสุดของ object literal เป็น [key, valueText] */
function splitTopLevelProperties(body) {
  const inner = body.slice(1, -1)
  const items = []
  let depth = 0
  let start = 0
  let i = 0
  const push = (chunk) => {
    const t = chunk.trim()
    if (!t) return
    // หา ':' ตัวแรกที่อยู่นอกวงเล็บ/สตริง
    let d = 0
    for (let k = 0; k < t.length; k++) {
      const c = t[k]
      if (c === '"' || c === "'" || c === '`') { k = skipString(t, k) - 1; continue }
      if (c === '{' || c === '(' || c === '[') d++
      else if (c === '}' || c === ')' || c === ']') d--
      else if (c === ':' && d === 0) {
        if (t[k + 1] === ':') continue
        items.push([t.slice(0, k).trim(), t.slice(k + 1).trim()])
        return
      }
    }
  }
  for (; i < inner.length; i++) {
    const c = inner[i]
    if (c === '"' || c === "'" || c === '`') { i = skipString(inner, i) - 1; continue }
    if (c === '/' && inner[i + 1] === '/') { while (i < inner.length && inner[i] !== '\n') i++; continue }
    if (c === '/' && inner[i + 1] === '*') { const e = inner.indexOf('*/', i + 2); i = e < 0 ? inner.length : e + 1; continue }
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) { push(inner.slice(start, i)); start = i + 1 }
  }
  push(inner.slice(start))
  return items
}

/** อ่านค่าคงที่สตริงของแอพ เช่น MISSION_SKILL_NAME = "autorun" (ใช้กับคีย์แบบ [MISSION_SKILL_NAME]) */
function readStringConstant(src, name) {
  const re = new RegExp('var ' + name + ' = ("(?:[^"\\\\]|\\\\.)*")')
  const m = re.exec(src)
  return m ? decodeJsString(m[1]) : null
}

/**
 * อ่านค่าคงที่สตริงแบบกว้าง (var/const/let/ไม่มีตัวประกาศ) — รองรับการต่อสตริงด้วย +
 * ใช้เมื่อค่าในตารางเป็น "ชื่อตัวแปร" ไม่ใช่สตริงตรง ๆ เช่น
 *   var DEFAULT_MISSION_PROMPT = "Complete the user's request fully. ..."
 *   var BUILTIN_SKILLS = { [MISSION_SKILL_NAME]: DEFAULT_MISSION_PROMPT }
 * ของเดิมข้ามเคสนี้ ทำให้ทูลทิปของสกิลภารกิจ/พรีวิวไม่ถูกสแกนเลย (หน้าจอยังเป็นอังกฤษ)
 */
function readNamedString(src, name) {
  const esc = name.replace(/[$]/g, '\\$')
  const re = new RegExp('(?:^|[\\s;{])(?:var|const|let)?\\s*' + esc + '\\s*=\\s*')
  const m = re.exec(src)
  if (!m) return null
  const tail = src.slice(m.index + m[0].length)
  // จับนิพจน์สตริงที่ต่อกันด้วย + (หยุดเมื่อเจออักขระที่ไม่ใช่สตริง/บวก/ช่องว่าง)
  const exprRe = /^(?:\s*"(?:[^"\\]|\\.)*"\s*\+)*\s*"(?:[^"\\]|\\.)*"/
  const em = exprRe.exec(tail)
  return em ? evalStringExpr(em[0]) : null
}

/** อ่าน object literal ที่ประกาศด้วย anchor เช่น 'var BUILTIN_SKILLS = {' → Map<ชื่อคีย์, ข้อความ> */
function readStringTable(src, anchor) {
  const at = src.indexOf(anchor)
  if (at < 0) return null
  const braceAt = src.indexOf('{', at + anchor.length - 1)
  if (braceAt < 0) return null
  const body = readBlock(src, braceAt)
  const table = new Map()
  for (const [keyText, valueText] of splitTopLevelProperties(body)) {
    let key = null
    if (/^[A-Za-z_$][\w$]*$/.test(keyText)) key = keyText
    else if (/^["'][^"']+["']$/.test(keyText)) key = decodeJsString(keyText)
    else if (/^\[\s*([A-Za-z_$][\w$]*)\s*\]$/.test(keyText)) {
      // คีย์แบบคำนวณจากค่าคงที่ (เช่น [MISSION_SKILL_NAME]) → "autorun"
      key = readStringConstant(src, keyText.slice(1, -1).trim())
    }
    if (!key) continue
    let value = evalStringExpr(valueText)
    // ค่าเป็น "ชื่อตัวแปร" → ไปอ่านค่าของตัวแปรนั้น (เช่น DEFAULT_MISSION_PROMPT)
    if (value == null && /^[A-Za-z_$][\w$]*$/.test(valueText)) value = readNamedString(src, valueText)
    if (value == null) continue
    table.set(key, value)
  }
  return table
}

// ── ตรรกะเดียวกับ UI: ข้อความในชิปสกิล (ChIP_TOOLTIP) ──────────────────────────
// UI: ใช้ description ถ้ามี ไม่งั้นเอาย่อหน้าแรกของ prompt มาต่อกัน แล้วตัดที่ช่องว่างสุดท้ายก่อน 220 ตัว
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[^\n]*(?:\r?\n|$)/
const DEFAULT_CHIP_MAX = 220

/** อ่านความยาวสูงสุดของทูลทิปจากบันเดิล UI (ตามรุ่นของแอพ) — สำคัญเพราะคีย์ต้องตรงเป๊ะ */
function chipMaxFromBundle(bundleSrc) {
  if (!bundleSrc) return DEFAULT_CHIP_MAX
  const m = /const\s+[A-Za-z_$][\w$]*=(\d+)\s*,\s*[A-Za-z_$][\w$]*=\/\^---/.exec(bundleSrc)
  return m ? Number(m[1]) : DEFAULT_CHIP_MAX
}

function chipTooltip(prompt, description, chipMax) {
  let text = (description || '').trim()
  if (!text) {
    const lines = []
    for (const line of String(prompt || '').replace(FRONTMATTER_RE, '').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) { if (lines.length > 0) break; continue }
      lines.push(t)
    }
    text = lines.join(' ')
  }
  if (text.length <= chipMax) return text
  const head = text.slice(0, chipMax)
  const cut = head.lastIndexOf(' ')
  return (cut > 0 ? head.slice(0, cut) : head) + '…'
}

// ── ข้อความ error ของระบบสกิลที่ผู้ใช้เห็น (toast/กล่องข้อความในตัวแก้ไขสกิล) ──
// เก็บเป็นรายการเจาะจง (ตรวจกับซอร์สจริงทุกครั้ง) เพื่อไม่ให้กวาดข้อความภายในไลบรารีเข้ามา
const SKILL_ERROR_TEXTS = [
  'That is not a valid skill id.',
  'The created skill could not be read back.',
  'The installed skill could not be read back.',
  'The registry did not return that skill.',
  'built-in skills cannot be deleted',
  'invalid Agent Skill: check the SKILL.md frontmatter',
  'only built-in skills can be customized this way',
  'this skill has no built-in version',
  'this skill is not a Freebuff-created built-in customization',
  'This thread has no running preview. Start one with the preview skill / register_preview first.',
  'id required',
  'name and prompt required',
  'no project',
]

/** รูปแบบข้อความที่มีตัวแปร (ต้องมีคู่กับ patterns ในพจนานุกรม) */
const SKILL_PATTERN_TEXTS = [
  'a skill named “{name}” already exists in that scope',
  '{scope} Agent Skills are not configured',
  'Customize the Freebuff {name} workflow',
]

/** ข้อความภายใน (ไม่ขึ้นหน้าจอผู้ใช้ทั่วไป) — เก็บไว้ใน ignore.json พร้อมเหตุผล ไม่ใช่ที่นี่ */
const INTERNAL_HINTS = [
  'invalid passive skill context',
  'The provider does not support skills',
  'registry returned an unsafe skill package path',
  'skill package destination contains a symbolic link',
  "Invalid skill name '",
]

/**
 * รวมข้อความ UI ทั้งหมดที่ดึงได้จากซอร์สของ orchestrator
 * @returns {{ strings: Map<string, number>, patterns: Map<string, number>, missingFromSource: string[], chipMax: number }}
 */
function collectOrchestratorUiStrings(src, opts = {}) {
  const chipMax = opts.chipMax || chipMaxFromBundle(opts.bundleSrc) || DEFAULT_CHIP_MAX
  const strings = new Map()
  const patterns = new Map()
  const missingFromSource = []
  const add = (map, text, n = 1) => { if (!text) return; map.set(text, (map.get(text) || 0) + n) }

  // 1) ทูลทิปของชิปสกิล (คำอธิบายสกิล + สกิลที่ใช้ย่อหน้าแรกของ prompt)
  const skills = readStringTable(src, 'var BUILTIN_SKILLS = {') || new Map()
  const descriptions = readStringTable(src, 'BUILTIN_SKILL_DESCRIPTIONS = {') || new Map()
  for (const [name, prompt] of skills) {
    const tip = chipTooltip(prompt, descriptions.get(name), chipMax)
    if (tip) add(strings, tip)
  }
  // คำอธิบายที่ไม่มีสกิลคู่กัน (เช่นของ mission/apply-locally) ก็ยังขึ้นหน้าจอได้
  for (const [name, desc] of descriptions) {
    if (skills.has(name)) continue
    const tip = chipTooltip('', desc, chipMax)
    if (tip) add(strings, tip)
  }

  // 2) ข้อความ error ของระบบสกิล + รูปแบบที่มีตัวแปร
  for (const text of SKILL_ERROR_TEXTS) {
    if (!src.includes(text)) { missingFromSource.push(text); continue }
    add(strings, text)
  }
  const haystack = probeSource(src)
  for (const text of SKILL_PATTERN_TEXTS) {
    const probe = text.replace(/\{[a-z]+\}/g, '{x}')
    if (!haystack.includes(probe)) { missingFromSource.push(text); continue }
    add(patterns, text)
  }

  return { strings, patterns, missingFromSource, chipMax }
}

/** ซอร์สแบบ "อ่านง่าย" สำหรับตรวจว่าข้อความยังอยู่ไหม (ถอด \uXXXX และแทน ${...} ด้วย {x}) */
function probeSource(src) {
  return String(src)
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\$\{[^}]*\}/g, '{x}')
}

/** หาไฟล์ orchestrator.js ที่ติดตั้งอยู่ (คู่กับบันเดิล UI) */
function findOrchestrators(files) {
  const list = files && files.length ? files : autoFindBundles()
  const out = []
  for (const f of list) {
    const p = path.resolve(path.dirname(f), '..', '..', 'orchestrator.js')
    if (fs.existsSync(p) && !out.includes(p)) out.push(p)
  }
  return out
}

/**
 * รวมข้อความ UI ของ orchestrator จากทุกที่ติดตั้ง (ใช้ร่วมกับ check-dict / dict-tools)
 * @returns {{ strings: Map, patterns: Map, missingFromSource: string[], chipMax: number, sources: string[], error: string|null }}
 */
function collectFromInstalls(bundles) {
  const merged = {
    strings: new Map(),
    patterns: new Map(),
    missingFromSource: [],
    chipMax: DEFAULT_CHIP_MAX,
    sources: [],
    error: null,
  }
  let list = []
  try { list = bundles && bundles.length ? bundles : autoFindBundles() } catch (e) { merged.error = e.message; return merged }
  const files = findOrchestrators(list)
  merged.sources = files
  let bundleSrc = null
  for (const b of list) { try { bundleSrc = fs.readFileSync(b, 'utf8'); break } catch (e) { /* ข้าม */ } }
  let fixEncoding = (s) => s
  try { ({ fixEncoding } = require('./gap-report.js')) } catch (e) { /* ใช้ค่าเริ่มต้น */ }
  for (const f of files) {
    try {
      const r = collectOrchestratorUiStrings(fixEncoding(fs.readFileSync(f, 'utf8')), { bundleSrc })
      for (const [k, v] of r.strings) merged.strings.set(k, (merged.strings.get(k) || 0) + v)
      for (const [k, v] of r.patterns) merged.patterns.set(k, (merged.patterns.get(k) || 0) + v)
      merged.missingFromSource.push(...r.missingFromSource)
      merged.chipMax = r.chipMax
    } catch (e) { merged.error = e.message }
  }
  return merged
}

function main() {
  const argv = process.argv.slice(2)
  const jsonIdx = argv.indexOf('--json')
  const outJson = jsonIdx !== -1 ? argv[jsonIdx + 1] : null
  const list = argv.includes('--list')
  const positional = argv.filter((a) => !a.startsWith('--') && a !== outJson)

  const bundles = autoFindBundles()
  const orchFiles = positional.length ? positional : findOrchestrators(bundles)
  if (!orchFiles.length) {
    console.error('ไม่พบ orchestrator.js ของแอพ — ระบุ path เองได้')
    process.exit(1)
  }
  let bundleSrc = null
  for (const b of bundles) { try { bundleSrc = fs.readFileSync(b, 'utf8'); break } catch (e) { /* ข้าม */ } }

  const { fixEncoding } = require('./gap-report.js')
  const all = { strings: new Map(), patterns: new Map(), missingFromSource: [], chipMax: DEFAULT_CHIP_MAX }
  for (const f of orchFiles) {
    const src = fixEncoding(fs.readFileSync(f, 'utf8'))
    const r = collectOrchestratorUiStrings(src, { bundleSrc })
    for (const [k, v] of r.strings) all.strings.set(k, (all.strings.get(k) || 0) + v)
    for (const [k, v] of r.patterns) all.patterns.set(k, (all.patterns.get(k) || 0) + v)
    all.missingFromSource.push(...r.missingFromSource)
    all.chipMax = r.chipMax
  }

  console.log(`แหล่งที่มา: ${orchFiles.join(', ')}`)
  console.log(`ความยาวทูลทิปของชิป: ${all.chipMax} ตัวอักษร`)
  console.log(`ข้อความ UI จาก orchestrator: ${all.strings.size} คำ · รูปแบบที่มีตัวแปร: ${all.patterns.size}`)
  if (list) {
    console.log('\n— ข้อความ —')
    for (const [k, n] of [...all.strings].sort()) console.log(`${String(n).padStart(3)}  ${JSON.stringify(k)}`)
    console.log('\n— รูปแบบ —')
    for (const [k, n] of all.patterns) console.log(`${String(n).padStart(3)}  ${JSON.stringify(k)}`)
  }
  if (all.missingFromSource.length) {
    console.log(`\n! ไม่พบข้อความที่คาดไว้ในซอร์ส (แอพอัปเดตถ้อยคำ?) ${all.missingFromSource.length} รายการ`)
    for (const m of new Set(all.missingFromSource)) console.log(`    - ${JSON.stringify(m)}`)
  }

  if (outJson) {
    const result = {
      generatedAt: new Date().toISOString(),
      mode: 'orchestrator',
      sources: orchFiles,
      chipMax: all.chipMax,
      total: all.strings.size,
      strings: Object.fromEntries([...all.strings].sort((a, b) => a[0].localeCompare(b[0]))),
      patterns: Object.fromEntries([...all.patterns].sort((a, b) => a[0].localeCompare(b[0]))),
    }
    fs.mkdirSync(path.dirname(path.resolve(outJson)), { recursive: true })
    fs.writeFileSync(path.resolve(outJson), JSON.stringify(result, null, 2) + '\n', 'utf8')
    console.log(`\nเขียน ${all.strings.size} ข้อความไปที่ ${outJson}`)
  }
}

if (require.main === module) main()
module.exports = {
  collectOrchestratorUiStrings,
  collectFromInstalls,
  findOrchestrators,
  readStringTable,
  readStringConstant,
  readNamedString,
  evalStringExpr,
  decodeJsString,
  chipTooltip,
  chipMaxFromBundle,
  probeSource,
  SKILL_ERROR_TEXTS,
  SKILL_PATTERN_TEXTS,
  INTERNAL_HINTS,
  DEFAULT_CHIP_MAX,
}
