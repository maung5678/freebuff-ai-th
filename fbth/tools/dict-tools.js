#!/usr/bin/env node
/**
 * dict-tools.js — เครื่องมือดูแลพจนานุกรม (ใช้ซ้ำได้ทุกครั้งที่แอพอัปเดต)
 *
 *   node fbth/tools/dict-tools.js prune [--write]   # ลบคีย์ที่ไม่มีข้อความนี้ในบันเดิลแล้ว
 *                                                   # (ค่าเริ่มต้น = แค่รายงาน, --write = แก้ไฟล์จริง)
 *   node fbth/tools/dict-tools.js todo  [--write]   # สร้าง dict/TODO.md = ข้อความ UI ที่ยังไม่แปล
 *   node fbth/tools/dict-tools.js stats             # สรุปจำนวนคีย์/ความครอบคลุม
 *
 * หมายเหตุ: prune เป็นการ "ย้ายออก" ไม่ใช่ลบถาวร — คีย์ที่ถูกตัดจะถูกเก็บไว้ใน
 * fbth/dict/removed.json พร้อมคำแปลไทย เพื่อให้กู้คืนหรือย้ายไป patch ส่วนอื่น (เช่น เมนู native)
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { autoFindBundles } = require('./extract-strings.js')

const ROOT = path.resolve(__dirname, '..')
const DICT_DIR = path.join(ROOT, 'dict')

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return fallback }
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

function dictFiles() {
  return fs.readdirSync(DICT_DIR)
    .filter((f) => /^th.*\.json$/.test(f) && f !== 'th.json' || f === 'th.json')
    .filter((f) => /^th[\w.-]*\.json$/.test(f) && !/^th\.(removed|backup)/.test(f))
    .sort((a, b) => (a === 'th.json' ? -1 : b === 'th.json' ? 1 : a.localeCompare(b)))
}

function loadBundles() {
  const files = [...new Set(autoFindBundles())]
  // ปรับข้อความที่ถูกรหัสเพี้ยนก่อนเทียบ (ไฟล์ของสำเนา/clone อาจเป็น mojibake)
  const { fixEncoding } = require('./gap-report.js')
  return files.map((f) => ({ path: f, src: fixEncoding(fs.readFileSync(f, 'utf8')) }))
}

function presentIn(srcs, key) {
  return srcs.some((s) => s.src.includes(key))
}

/** แหล่งข้อความชุดเดียวกับที่ check-dict ใช้ (bundles + orchestrator + ไฟล์ใน app.asar)
 *  สำคัญ: การเทียบด้วย includes() กับบันเดิล UI อย่างเดียวจะ 'ตัดคำที่ยังใช้จริง' ทิ้งหลายร้อยคำ */
function dictionarySources() {
  try {
    const { collectDictionarySources } = require('./check-dict.js')
    const { bundles, sources, orchestratorUi } = collectDictionarySources([...new Set(autoFindBundles())])
    let keyLooksPresent = (src, k) => src.includes(k)
    try { ({ keyLooksPresent } = require('./check-dict.js')) } catch (e) { /* ใช้ตัวง่าย */ }
    return { bundles, sources, orchestratorUi, keyLooksPresent }
  } catch (e) {
    console.warn(`! รวมแหล่งข้อความไม่สำเร็จ: ${e.message}`)
    return { bundles: [], sources: [], orchestratorUi: { strings: new Map() }, keyLooksPresent: null }
  }
}

function presentInAll(ctx, key) {
  if (ctx.orchestratorUi && ctx.orchestratorUi.strings.has(key)) return true
  if (!ctx.keyLooksPresent) return ctx.sources.some((s) => s.src.includes(key))
  return ctx.sources.some((s) => ctx.keyLooksPresent(s.src, key))
}

/** ข้อความ UI ที่ผู้ใช้เห็นซึ่งมาจาก orchestrator.js (ทูลทิปชิปสกิล/ข้อความ error ของระบบสกิล)
 *  บางส่วนถูกประกอบขึ้นมา (ตัดทอน/ต่อบรรทัด) จึงเทียบกับบันเดิลตรง ๆ ไม่ได้ — ต้องคำนวณด้วยเครื่องมือนี้
 *  ถ้าไม่ทำ คีย์เหล่านี้จะถูก prune ทิ้งทั้งที่ยังใช้อยู่จริง */
function orchestratorStrings() {
  try {
    return require('./extract-orchestrator-strings.js').collectFromInstalls(autoFindBundles())
  } catch (e) {
    console.warn(`! ตรวจข้อความจาก orchestrator ไม่ได้: ${e.message}`)
    return { strings: new Map(), patterns: new Map() }
  }
}

function cmdPrune(argv) {
  const write = argv.includes('--write')
  // ใช้แหล่งข้อความชุดเดียวกับ check-dict เพื่อให้ตัวเลข "คีย์ตาย" ตรงกัน (กันการ prune คำที่ยังใช้จริง)
  const ctx = dictionarySources()
  const derived = new Set([
    ...orchestratorStrings().strings.keys(),
    ...(ctx.orchestratorUi ? ctx.orchestratorUi.strings.keys() : []),
  ])
  const files = dictFiles()
  const removedPath = path.join(DICT_DIR, 'removed.json')
  const removed = readJson(removedPath, { meta: { note: 'คีย์ที่ถูกตัดออกจากพจนานุกรมหลัก เพราะไม่พบข้อความนี้ในบันเดิล (เก็บไว้เพื่อกู้คืน/ย้ายไป patch ส่วนอื่น)' }, strings: {} })

  const seen = new Set()
  let moved = 0
  let dupes = 0
  let kept = 0

  for (const f of files) {
    const p = path.join(DICT_DIR, f)
    const data = readJson(p, null)
    if (!data) { console.warn(`ข้าม ${f} (อ่านไม่ได้)`); continue }
    const keep = {}
    for (const [k, v] of Object.entries(data.strings || {})) {
      if (seen.has(k)) {
        dupes++
        console.log(`= ซ้ำใน ${f}: ${JSON.stringify(k)} (ใช้ค่าจากไฟล์ก่อนหน้า)`)
        continue
      }
      if (!presentInAll(ctx, k) && !derived.has(k)) {
        removed.strings[k] = v
        moved++
        console.log(`- ตัดออกจาก ${f}: ${JSON.stringify(k)}`)
        continue
      }
      seen.add(k)
      keep[k] = v
      kept++
    }
    data.strings = keep
    if (write) writeJson(p, data)
  }

  console.log(`\nคงไว้ ${kept} คีย์ · ตัดออก ${moved} · ซ้ำ ${dupes} · (ข้อความจาก orchestrator ${derived.size} คำ)`)
  if (!write) {
    console.log('(โหมดรายงาน — ใส่ --write เพื่อแก้ไฟล์จริง)')
    return
  }
  writeJson(removedPath, removed)
  console.log(`เขียนไฟล์พจนานุกรมแล้ว และเก็บคีย์ที่ตัดไว้ที่ dict/removed.json`)
}

function cmdTodo(argv) {
  const write = argv.includes('--write')
  const th = readJson(path.join(DICT_DIR, 'th.json'), { strings: {} })
  const extra = {}
  for (const f of dictFiles()) {
    if (f === 'th.json') continue
    const d = readJson(path.join(DICT_DIR, f), {})
    Object.assign(extra, d.strings || {})
  }
  const known = new Set([...Object.keys(th.strings || {}), ...Object.keys(extra)])

  // ใช้ตัวกรองชุดเดียวกับ gap-report/check-dict (รวมกฎใน ignore.json)
  // เพื่อให้ตัวเลข "ยังไม่แปล" ของทุกเครื่องมือตรงกัน
  let relevant = () => true
  let fixEncoding = (s) => s
  try { ({ relevant, fixEncoding } = require('./gap-report.js')) } catch (e) { /* ใช้ตัวกรองเริ่มต้น */ }

  /** ขยายคีย์ที่มี mojibake ให้เป็นรูปแบบที่พจนานุกรมใช้ */
  const expand = (obj) => {
    const out = { ...obj }
    for (const k of Object.keys(obj)) out[fixEncoding(k)] = obj[k]
    return out
  }

  const jsx = { strings: expand(readJson(path.join(DICT_DIR, 'candidates-jsx.json'), { strings: {} }).strings) }
  const all = { strings: expand(readJson(path.join(DICT_DIR, 'candidates.json'), { strings: {} }).strings) }

  const isNoise = (s) =>
    /^[a-z0-9-]+ [a-z0-9-]+$/.test(s) ||                       // class name
    /^(Escape|Enter|End|Home|Tab|Quote|Backspace|ArrowDown|ArrowLeft|ArrowRight|ArrowUp|Delete|Shift-|Ctrl-|Alt-|AltGraph|Macintosh|Firefox|Chrome|Edge|Android)$/.test(s) ||
    /^(GPT|Opus|Sonnet|Fable|GLM|Claude|Codex)/.test(s) ||      // ชื่อโมเดล
    /^[@.](.*)$/.test(s) === false && /^(bun install|npm |git )/.test(s)

  const todo = Object.keys(jsx.strings).filter((s) => !known.has(s) && !isNoise(s) && relevant(s))
  const todoLong = Object.keys(all.strings)
    .filter((s) => !known.has(s) && s.length > 14 && s.includes(' ') && !isNoise(s) && relevant(s))

  // 3) ข้อความที่ผู้ใช้เห็นซึ่งมาจาก orchestrator (ทูลทิปสกิล/ข้อความ error ของระบบสกิล)
  const orch = orchestratorStrings()
  const orchTodo = [...orch.strings.keys()].filter((s) => !known.has(s))
  const knownPatterns = new Set()
  for (const f of dictFiles()) {
    for (const p of readJson(path.join(DICT_DIR, f), {}).patterns || []) knownPatterns.add(String(p.from))
  }
  const orchPatternTodo = [...orch.patterns.keys()].filter((p) => !knownPatterns.has(p))

  const lines = []
  lines.push('# ข้อความ UI ที่ยังไม่ถูกแปล (สร้างอัตโนมัติ)')
  lines.push('')
  lines.push(`สร้างเมื่อ: ${new Date().toISOString()}`)
  lines.push('')
  lines.push(`## 1) ข้อความที่ยืนยันว่าอยู่บนหน้าจอ (JSX children/attribute): ${todo.length} คำ`)
  lines.push('')
  lines.push('วางคำแปลในไฟล์ `dict/th-<ชื่อ>.json` รูปแบบเดียวกับ `th-extra.json` (patcher จะ merge ให้)')
  lines.push('')
  for (const s of todo) lines.push(`- [ ] ${s}`)
  lines.push('')
  lines.push(`## 2) ข้อความยาวที่น่าจะเป็น UI (ยังไม่ยืนยันตำแหน่ง): ${todoLong.length} คำ`)
  lines.push('')
  for (const s of todoLong) lines.push(`- [ ] ${s}`)
  lines.push('')
  lines.push(`## 3) ทูลทิปสกิล/ข้อความ error ที่มาจาก orchestrator.js: ${orchTodo.length} คำ (pattern ${orchPatternTodo.length})`)
  lines.push('')
  lines.push('ดึงซ้ำได้ด้วย `node fbth/tools/extract-orchestrator-strings.js --list` (คีย์ต้องคัดลอกจากไฟล์นี้เท่านั้น)')
  lines.push('')
  for (const s of orchTodo) lines.push(`- [ ] ${s}`)
  for (const s of orchPatternTodo) lines.push(`- [ ] (pattern) ${s}`)
  lines.push('')

  const out = path.join(DICT_DIR, 'TODO.md')
  if (write) {
    fs.writeFileSync(out, lines.join('\n'), 'utf8')
    console.log(`เขียน ${out}: JSX ค้าง ${todo.length} คำ, ยาวค้าง ${todoLong.length} คำ, orchestrator ค้าง ${orchTodo.length} คำ`)
  } else {
    console.log(lines.slice(0, 40).join('\n'))
    console.log(`… (โหมดรายงาน — ใส่ --write เพื่อเขียน dict/TODO.md)`)
  }
}

function cmdStats() {
  const th = readJson(path.join(DICT_DIR, 'th.json'), { strings: {} })
  const files = dictFiles()
  let extra = 0
  for (const f of files) {
    if (f === 'th.json') continue
    extra += Object.keys(readJson(path.join(DICT_DIR, f), {}).strings || {}).length
  }
  const jsx = readJson(path.join(DICT_DIR, 'candidates-jsx.json'), { strings: {} })
  console.log(`ไฟล์พจนานุกรม: ${files.join(', ')}`)
  console.log(`คีย์ใน th.json: ${Object.keys(th.strings || {}).length} · คีย์ในไฟล์เสริม: ${extra}`)
  console.log(`pattern: ${(th.patterns || []).length} · phrase: ${Object.keys(th.phrases || {}).length}`)
  console.log(`ข้อความ JSX ทั้งหมด: ${Object.keys(jsx.strings || {}).length}`)
}

const cmd = process.argv[2]
const rest = process.argv.slice(3)
if (cmd === 'prune') cmdPrune(rest)
else if (cmd === 'todo') cmdTodo(rest)
else if (cmd === 'stats') cmdStats()
else {
  console.log('ใช้: dict-tools.js <prune|todo|stats> [--write]')
  process.exit(1)
}
