#!/usr/bin/env node
/**
 * gap-report.js — เทียบข้อความที่สแกนได้จากแอพ กับพจนานุกรมไทยที่เรามี
 * แล้วสรุปว่า "ยังเหลืออะไรที่ควรแปล" พร้อมตัวอย่างให้ตรวจด้วยตา
 *
 * ใช้:
 *   node fbth/tools/gap-report.js fbth/dict/candidates-objects.json [--limit 40] [--json out.json]
 *   node fbth/tools/gap-report.js --auto          # สแกนเองทั้ง UI + orchestrator
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DICT_DIR = path.join(__dirname, '..', 'dict')

/**
 * ข้อความที่ถูกรหัสเพี้ยน (UTF-8 → Latin-1) จากสำเนาแอพที่ถูกสคริปต์ PowerShell เขียนทับ
 * ใช้ตารางเดียวกับ runtime/fbth-th.js เพื่อให้ตัวตรวจกับตัวแปลเห็นข้อความเดียวกัน
 */
const MOJIBAKE = [
  ['\u00e2\u20ac\u00a6', '\u2026'],
  ['\u00e2\u20ac\u2122', '\u2019'],
  ['\u00e2\u20ac\u0153', '\u201c'],
  ['\u00e2\u20ac\u009d', '\u201d'],
  ['\u00e2\u20ac\u201c', '\u2013'],
  ['\u00e2\u20ac\u201d', '\u2014'],
  ['\u00c2\u00b7', '\u00b7'],
]

function fixEncoding(text) {
  let out = String(text)
  for (const [bad, good] of MOJIBAKE) if (out.includes(bad)) out = out.split(bad).join(good)
  return out
}

function loadDict() {
  const all = { strings: {}, phrases: {}, patterns: [] }
  for (const f of fs.readdirSync(DICT_DIR).filter((n) => /^th[\w.-]*\.json$/.test(n) && !/^th-(removed|backup)/.test(n)).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(DICT_DIR, f), 'utf8'))
    Object.assign(all.strings, j.strings || {})
    Object.assign(all.phrases, j.phrases || {})
    for (const p of j.patterns || []) all.patterns.push(p)
  }
  const shell = path.join(DICT_DIR, 'shell-th.json')
  if (fs.existsSync(shell)) {
    const j = JSON.parse(fs.readFileSync(shell, 'utf8'))
    Object.assign(all.strings, j.strings || {})
  }
  return all
}

/** ข้อความที่มีแต่ตัวอักษรอังกฤษ/ตัวเลข/เครื่องหมายวรรคตอน (ไม่ใช่ภาษาไทย) */
function isEnglish(s) {
  return !/[\u0E00-\u0E7F]/.test(s)
}

/** โหลดรายการ "ไม่แปลโดยเจตนา" (ชื่อภาษา/แบรนด์/ภายในของไลบรารี) */
function loadIgnore(dir = DICT_DIR) {
  const p = path.join(dir, 'ignore.json')
  const rules = []
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'))
    for (const e of j.patterns || []) {
      try { rules.push({ re: new RegExp(e.re), reason: e.reason || 'ignored' }) } catch (err) { /* regex เสีย ข้าม */ }
    }
  } catch (e) { /* ไม่มีไฟล์ ignore ก็ทำงานต่อได้ */ }
  return rules
}

const IGNORE = loadIgnore()

/** เหตุผลที่ข้อความนี้ไม่ต้องแปล (คืน null ถ้าควรแปล) */
function ignoreReason(s) {
  for (const r of IGNORE) if (r.re.test(s)) return r.reason
  return null
}

function relevant(s) {
  if (!isEnglish(s)) return false
  if (s.length < 2) return false
  if (ignoreReason(s)) return false
  // ข้ามสัญญาณของ internals
  if (/^(?:[a-z0-9]+[.:/\\-]){2,}/i.test(s)) return false
  if (/\.(?:js|ts|cjs|mjs|json|md|css|html|png|svg)\b/.test(s)) return false
  if (/\b(?:localhost|127\.0\.0\.1|http|https|Bearer|Content-Type|utf-8)\b/i.test(s)) return false
  if (/^[\w-]+\/[\w-]+$/.test(s)) return false
  return true
}

/**
 * รูปแบบที่มีตัวแปรนี้ "ควรมีคำแปล" จริงหรือไม่
 * ตัวสแกนอาจสร้างรูปแบบหลอกขึ้นมา (เช่น "{n} {n2}{n3}" จากข้อความที่มีแต่ตัวเลข)
 * และถ้าใส่เข้าไปในพจนานุกรม มันจะกวาดข้อความเกือบทุกอย่างแล้วคืนค่าเดิม → ไปบังการแปลแบบอื่น
 * เกณฑ์: มีตัวแทนแบบกว้าง (catch-all) ตั้งแต่ 2 ตัวขึ้นไป และไม่มีข้อความจริงคั่น → ไม่นับเป็นงานที่ต้องแปล
 */
function isOverbroadPattern(from) {
  const text = String(from || '')
  const placeholders = [...text.matchAll(/\{([a-zA-Z0-9_]+)(?::([^}]*))?\}/g)]
  const rest = text.replace(/\{[a-zA-Z0-9_]+(?::[^}]*)?\}/g, ' ')
  const hasLetters = /[A-Za-z]{2,}/.test(rest)
  const generic = placeholders.filter((m) => !m[2] || m[2] === '').length
  return generic >= 2 && !hasLetters
}

/** รูปแบบที่ไม่ควรอยู่ในพจนานุกรมเลย (ไร้ประโยชน์/กว้างเกินไป) */
function badPatternReason(p) {
  const from = String(p && p.from)
  const to = String(p && p.to)
  if (!from || !to) return 'ไม่มี from/to'
  if (from === to) return 'รูปแบบที่ไม่ทำอะไรเลย (from === to)'
  if (isOverbroadPattern(from)) return 'รูปแบบกว้างเกินไป (ไม่มีข้อความจริงคั่นระหว่างตัวแปร)'
  return null
}

function report(strings, dict, { limit = 40, quiet = false } = {}) {
  // รวมคีย์ที่ถูกรหัสเพี้ยนเข้ากับคีย์ปกติ (ไม่งั้นจะรายงานเป็น "ยังไม่แปล" ทั้งที่พจนานุกรมมีแล้ว)
  const merged = {}
  for (const [k, v] of Object.entries(strings)) {
    const clean = fixEncoding(k)
    merged[clean] = Math.max(merged[clean] || 0, v)
  }
  strings = merged
  const keys = Object.keys(strings)
  // คำที่อยู่ใน phrases ก็ถือว่า "มีคำแปลแล้ว" (ใช้แทนที่กลางข้อความที่แอพต่อเองจากหลายส่วน)
  const known = keys.filter((k) => k in dict.strings || k in (dict.phrases || {}))
  const gaps = keys.filter((k) => !(k in dict.strings) && !(k in (dict.phrases || {})) && relevant(k))
  const noise = keys.length - known.length - gaps.length
  if (!quiet) {
    console.log(`ข้อความที่สแกนได้: ${keys.length}`)
    console.log(`  มีคำแปลแล้ว      : ${known.length}`)
    console.log(`  ยังไม่มีคำแปล    : ${gaps.length}`)
    console.log(`  (ตัดออกเป็น noise): ${noise}`)
    console.log('\nตัวอย่างที่ยังไม่แปล (เรียงตามความถี่):')
    for (const g of gaps.slice(0, limit)) console.log(`  ${String(strings[g]).padStart(3)}  ${JSON.stringify(g)}`)
  }
  return { total: keys.length, known: known.length, gaps, noise }
}

function main() {
  const argv = process.argv.slice(2)
  const limitIdx = argv.indexOf('--limit')
  const limit = limitIdx !== -1 ? Number(argv[limitIdx + 1]) : 40
  const jsonIdx = argv.indexOf('--json')
  const outJson = jsonIdx !== -1 ? argv[jsonIdx + 1] : null
  const file = argv.find((a) => !a.startsWith('--') && a !== outJson && a !== String(limit))
  if (!file) {
    console.error('ใช้: node fbth/tools/gap-report.js <candidates-*.json> [--limit N] [--json out.json]')
    process.exit(1)
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const dict = loadDict()
  const r = report(data.strings || {}, dict, { limit })
  const pats = Object.keys(data.patterns || {}).filter((p) => !isOverbroadPattern(p))
  const dictPat = new Set(dict.patterns.map((p) => p.from))
  const patGaps = pats.filter((p) => !dictPat.has(p))
  console.log(`\nรูปแบบที่มีตัวแปร: ${pats.length} · ยังไม่มีคำแปล: ${patGaps.length}`)
  for (const p of patGaps.slice(0, Math.min(limit, 25))) console.log(`  ${JSON.stringify(p)}`)
  if (outJson) {
    fs.writeFileSync(path.resolve(outJson), JSON.stringify({ gaps: r.gaps, patternGaps: patGaps }, null, 2) + '\n', 'utf8')
    console.log(`\nเขียนรายการที่ยังขาดไปที่ ${outJson}`)
  }
}

if (require.main === module) main()
module.exports = {
  loadDict, report, relevant, isEnglish, loadIgnore, ignoreReason, fixEncoding, MOJIBAKE,
  isOverbroadPattern, badPatternReason,
}
