#!/usr/bin/env node
/**
 * extract-strings.js — ดึง "ข้อความ UI ภาษาอังกฤษ" ที่น่าจะเป็นข้อความบนหน้าจอ
 * ออกจาก JS bundle ของ Freebuff (React ที่ build แล้ว) เพื่อไปทำพจนานุกรมไทย
 *
 * ใช้:
 *   node fbth/tools/extract-strings.js <path/to/bundle.js> [--json out.json] [--min 2]
 *   node fbth/tools/extract-strings.js --auto            # หา bundle เองจากเครื่องนี้
 *
 * หลักการ: scan string literal (', ", `) ที่ไม่มีตัวแปร แล้วกรองด้วย heuristics
 *  - ต้องมีตัวอักษรอย่างน้อย 2 ตัว
 *  - ไม่มีอักขระที่เป็นสัญญาณของโค้ด (\ { } < > = $ | ~ ^ ` ; และ path/URL)
 *  - ต้องดูเป็นภาษาคน (มีช่องว่างและสัดส่วนตัวอักษรสูง หรือเป็นคำเดียวที่ขึ้นต้นด้วยตัวใหญ่)
 * ข้อความที่หลุดเข้ามาเกินไม่เป็นไร เพราะ translator ใช้การ "ตรงเป๊ะ" (exact match)
 * เท่านั้น ข้อความที่ไม่ตรงก็จะไม่ถูกแตะ
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const CODE_CHARS = /[\\{}<>=$|~^`\u0000-\u0008\u000b\u000c\u000e-\u001f]/
// "คำที่อ่านออก": ต้องมีตัวพิมพ์เล็กติดกัน 3 ตัว (เช่น usage/Delete) — ใช้ตัดชื่อตารางฟอนต์
// และสตริงภายในที่ถูกย่อแบบเข้ารหัส (เช่น "O'#KPO! bQ", "SBm;", "X2pQ-x") ออกก่อน
const READABLE_WORD = /[a-z]{3,}/
// คำสั้นที่ยังต้องเก็บ (Got it / OK / Yes / Max / Retry) — ไม่มีตัวอักษรอย่างอื่นนอกจาก ' และช่องว่าง
const SIMPLE_SHORT = /^[A-Za-z][A-Za-z'\u2019 ]{0,19}$/
const STOPWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'function', 'return', 'object', 'string', 'number',
  'boolean', 'symbol', 'bigint', 'constructor', 'prototype', 'default', 'module', 'exports',
  'string', 'button', 'submit', 'dialog', 'div', 'span', 'input', 'onclick', 'onchange',
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
])

function unescapeJs(raw) {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\`/g, '`')
    .replace(/\\\$/g, '$')
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\([\\/])/g, '$1')
}

/**
 * ดึง string literal ทั้งหมดจากซอร์ส (ข้าม regex literal)
 *
 * สำคัญ: เทมเพลต `` `a${b}` `` ต้องสแกน "โค้ด" ใน ${...} ด้วย ไม่ใช่กินเป็นข้อความดิบ
 * เพราะบันเดิลที่ย่อแล้วมีเทมเพลตซ้อนเทมเพลตและมีสตริงอยู่ใน ${...}
 * (ของเดิมจะหลุดจังหวะจาก nested template แล้วกินโค้ดเป็น "ข้อความ" ไปเรื่อย ๆ
 *  ทำให้ข้อความ UI ท้ายไฟล์ — ซึ่งคือฟีเจอร์ใหม่ — ไม่ถูกสแกนเลย)
 */
function scanStringLiterals(src) {
  const out = []
  const n = src.length
  let prevSignificant = ''

  /** ข้ามสตริง/เทมเพลตที่เริ่มที่ i → index ถัดจากตัวปิด */
  function skipAnyString(i) {
    const quote = src[i]
    let j = i + 1
    while (j < n) {
      const c = src[j]
      if (c === '\\') { j += 2; continue }
      if (c === quote) return j + 1
      if (c === '\n' && quote !== '`') return j
      if (quote === '`' && c === '$' && src[j + 1] === '{') { j = matchingBrace(j + 1) + 1; continue }
      j++
    }
    return n
  }

  /** หา '}' ที่ตรงกับ '{' ที่ openIdx (เข้าใจสตริง/คอมเมนต์/เทมเพลตที่ซ้อนอยู่) */
  function matchingBrace(openIdx) {
    let depth = 0
    let k = openIdx
    while (k < n) {
      const c = src[k]
      if (c === '/' && src[k + 1] === '/') { const e = src.indexOf('\n', k); k = e === -1 ? n : e + 1; continue }
      if (c === '/' && src[k + 1] === '*') { const e = src.indexOf('*/', k + 2); k = e === -1 ? n : e + 2; continue }
      if (c === '"' || c === "'" || c === '`') { k = skipAnyString(k); continue }
      if (c === '{') depth++
      else if (c === '}') { depth--; if (depth === 0) return k }
      k++
    }
    return n
  }

  /** สแกนโค้ดในช่วง [start, end) — เก็บสตริงที่เจอ (เรียกซ้ำได้เมื่ออยู่ใน ${...}) */
  function scanCode(start, end) {
    let i = start
    while (i < end) {
      const ch = src[i]
      if (ch === '/' && src[i + 1] === '/') {
        const e = src.indexOf('\n', i)
        i = e === -1 || e > end ? end : e + 1
        continue
      }
      if (ch === '/' && src[i + 1] === '*') {
        const e = src.indexOf('*/', i + 2)
        i = e === -1 || e > end ? end : e + 2
        continue
      }
      // regex literal: / เจอในตำแหน่งที่ค่าก่อนหน้าไม่ใช่ตัวถูกดำเนินการ (และไม่ใช่คอมเมนต์)
      if (ch === '/' && !/[\w$)\]"'`]/.test(prevSignificant || '')) {
        let j = i + 1
        let inClass = false
        let ok = false
        while (j < end) {
          const c = src[j]
          if (c === '\\') { j += 2; continue }
          if (c === '[') inClass = true
          else if (c === ']') inClass = false
          else if (c === '/' && !inClass) { ok = true; break }
          else if (c === '\n') break
          j++
        }
        if (ok) { prevSignificant = '/'; i = j + 1; continue }
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1
        let raw = ''
        let closed = false
        while (j < end) {
          const c = src[j]
          if (c === '\\') { raw += src.slice(j, j + 2); j += 2; continue }
          if (c === ch) { closed = true; break }
          if (c === '\n') break
          raw += c
          j++
        }
        if (closed) {
          out.push({ value: unescapeJs(raw), quote: ch, hasSubstitution: false })
          prevSignificant = ch
          i = j + 1
          continue
        }
        i++
        continue
      }
      if (ch === '`') {
        let j = i + 1
        let raw = ''
        let hasSubstitution = false
        while (j < n) {
          const c = src[j]
          if (c === '\\') { raw += src.slice(j, j + 2); j += 2; continue }
          if (c === '`') { j++; break }
          if (c === '$' && src[j + 1] === '{') {
            const close = matchingBrace(j + 1)
            scanCode(j + 2, close)          // เก็บสตริงที่ซ่อนใน ${...}
            raw += '${x}'
            hasSubstitution = true
            j = close + 1
            continue
          }
          raw += c
          j++
        }
        out.push({ value: unescapeJs(raw), quote: '`', hasSubstitution })
        prevSignificant = '`'
        i = j
        continue
      }
      if (!/\s/.test(ch)) prevSignificant = ch
      i++
    }
  }

  scanCode(0, n)
  return out
}

function looksLikeUiText(value) {
  if (typeof value !== 'string') return false
  const s = value.trim()
  // 140 → 400: ตัวแปลตอนรันรองรับข้อความถึง 400 ตัวอักษร และข้อความยาว ๆ คือช่องที่เคยหลุด
  // (เช่น data-tooltip ของภารกิจ ซึ่งเป็นพรอมป์ทิ้งประโยคยาว 176 ตัวอักษร)
  if (s.length < 2 || s.length > 400) return false
  if (CODE_CHARS.test(s)) return false
  if (s.includes('://')) return false
  if (/[\\/]/.test(s)) return false // path / URL / อัตราส่วน
  if (/^[\w.-]+@[\w.-]+$/.test(s)) return false
  if (/\.[a-z]{2,4}$/.test(s) && !s.endsWith('.') && !s.includes(' ')) return false // filename
  if (s.includes('__') || s.includes('--') && !/[a-zA-Z]/.test(s)) return false
  if (/^[a-z][a-zA-Z0-9-]*$/.test(s) && !STOPWORDS.has(s)) return false // identifier เช่น className
  if (/^[A-Z_]{2,}$/.test(s)) return false // ตัวพิมพ์ใหญ่ล้วน (constant)
  if (STOPWORDS.has(s)) return false
  const letters = (s.match(/[A-Za-z]/g) || []).length
  if (letters < 2) return false
  const nonSpace = s.replace(/ /g, '').length
  if (letters / nonSpace < 0.45) return false
  const hasSpace = /\s/.test(s)
  const startsUpper = /^[A-Z]/.test(s)
  if (!hasSpace && !startsUpper) return false
  // ตัดคำสั่ง/โค้ดที่หลุดมา
  if (/^(function|class|import|export|const|let|var|await|async)\b/.test(s)) return false
  // ต้องมีคำภาษาอังกฤษอย่างน้อยหนึ่งคำที่อ่านออก
  if (!/[A-Za-z]{2,}/.test(s)) return false
  if (!READABLE_WORD.test(s) && !SIMPLE_SHORT.test(s)) return false
  return true
}

/**
 * โหมดแม่นยำสูง: หา string ที่อยู่ในตำแหน่งที่ React จะ render จริง
 * (JSX children, attribute ของ UI) — ข้อความที่ได้จึงเกือบทั้งหมดคือข้อความบนหน้าจอ
 * ใช้คู่กับ looksLikeUiText เพื่อกันของแปลกปลอม
 */
const UI_ATTRS = ['placeholder', 'title', 'aria-label', 'aria-description', 'aria-placeholder', 'alt', 'label', 'tooltip', 'emptyLabel', 'confirmLabel', 'cancelLabel']

function scanJsxStrings(src) {
  const out = new Map()
  const present = (v) => {
    // ต้องมีอยู่จริงในไฟล์ (กันข้อความผีที่เกิดจากการตัด chunk กลางสตริง)
    if (src.includes(JSON.stringify(v))) return true
    // เด็กใน JSX มักมีช่องว่างหัว/ท้าย ("Use the approach from ", " to add sign-in here.")
    // ตัวแปลตัดช่องว่างก่อนเทียบ คีย์จึงเป็นแบบไม่มีช่องว่าง → ยอมรับรูปแบบที่มีช่องว่างได้
    if (src.includes('" ' + v + '"') || src.includes('"' + v + ' "')) return true
    const single = "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
    if (src.includes(single)) return true
    const esc = v.replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
    return esc !== v && src.includes(JSON.stringify(esc))
  }
  const add = (raw) => {
    if (typeof raw !== 'string') return
    const v = raw.trim()
    if (!looksLikeUiText(v)) return
    if (!present(v)) return
    out.set(v, (out.get(v) || 0) + 1)
  }

  // children:"ข้อความ" และ children:["ก", "ข", expr]
  const childrenRe = /children:\s*(\[[\s\S]{0,600}?\]|"(?:[^"\\]|\\.)*")/g
  for (const m of src.matchAll(childrenRe)) {
    const chunk = m[1]
    if (chunk.startsWith('"')) add(unescapeJs(chunk.slice(1, -1)))
    else for (const lit of scanStringLiterals(chunk)) if (!lit.hasSubstitution) add(lit.value)
  }

  // attribute ที่ผู้ใช้เห็น (placeholder/title/aria-label/...) ในรูป คีย์: "ค่าที่ติดกัน"
  // ต้องรองรับคีย์ที่ถูกครอบด้วย " ด้วย ("aria-label":"...") เพราะ bundler จะใส่ "
  // ให้คีย์ที่มีอักขระ - เสมอ — ของเดิมพลาด aria-label ทั้งไฟล์เพราะเหตุนี้นี้
  const attrRe = new RegExp('(?:' + UI_ATTRS.map((a) => a.replace('-', '\\-')).join('|') + ')"?\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 'g')
  for (const m of src.matchAll(attrRe)) add(unescapeJs(m[1]))

  return out
}

/**
 * โหมดเก็บกวาด: หาข้อความ UI ที่อยู่ในรูปข้อมูล (ไม่ใช่ JSX)
 *   { title: "...", description: "..." } , actionLabel: "..." , actions: ["...","..."]
 *   และ template literal ที่มีตัวแปร → แปลงเป็น pattern เช่น `Delete ${n} files?`
 * ใช้ได้กับทั้ง bundle ของ UI และ orchestrator.js (ข้อความ error/สถานะที่โชว์ในแอพ)
 */
const OBJ_KEYS = [
  'title', 'subtitle', 'description', 'desc', 'label', 'labelText', 'tooltip', 'hint', 'help',
  'helpText', 'placeholder', 'message', 'msg', 'emptyText', 'emptyLabel', 'emptyMessage',
  'error', 'errorText', 'detail', 'details', 'summary', 'text', 'caption', 'heading', 'name',
  'confirm', 'confirmLabel', 'cancel', 'cancelLabel', 'action', 'actionLabel', 'button',
  'buttonLabel', 'note', 'noteText', 'warning', 'body', 'content', 'ariaLabel', 'legend',
  'prompt', 'footer', 'header', 'badge', 'tip', 'toast', 'status', 'statusText', 'reason',
  'cause', 'blurb', 'tagline', 'sublabel', 'titleText', 'intro', 'prose', 'explanation',
  // attribute ที่ผู้ใช้เห็น (bundler จะใส่ " ครอบเพราะมีอักขระ -) — ต้องสแกนเป็นค่าข้อความแบบ object ด้วย
  'aria-label', 'aria-description', 'aria-placeholder', 'data-tooltip', 'data-placeholder',
]

function scanUiObjects(src) {
  const strings = new Map()
  const patterns = new Map()

  const add = (v) => {
    if (typeof v !== 'string') return
    const s = v.trim()
    if (!looksLikeUiText(s)) return
    if (!src.includes(JSON.stringify(s)) && !src.includes("'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'")) return
    strings.set(s, (strings.get(s) || 0) + 1)
  }

  const keysAlt = OBJ_KEYS.map((k) => k.replace(/[$]/g, '\\$')).join('|')
  // "? หลังชื่อคีย์ = รองรับคีย์ที่ bundler ใส่ " ครอบ (เพราะมีอักขระพิเศษ)
  const objRe = new RegExp('(?:' + keysAlt + ')"?\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 'g')
  for (const m of src.matchAll(objRe)) add(unescapeJs(m[1]))

  // template literal: ข้อความที่มีตัวแปร → pattern (เก็บชื่อตัวแปรไว้เป็น {n})
  const tplRe = new RegExp('(?:' + keysAlt + ')"?\\s*:\\s*`((?:[^`\\\\]|\\\\.)*)`', 'g')
  for (const m of src.matchAll(tplRe)) {
    const raw = m[1]
    if (!/\$\{/.test(raw)) { add(unescapeJs(raw)); continue }
    let idx = 0
    const withSlots = raw.replace(/\$\{[^}]*\}/g, () => '{n' + (idx++ ? idx : '') + '}')
    const from = unescapeJs(withSlots)
    if (!looksLikeUiText(from.replace(/\{n\d*\}/g, 'x'))) continue
    if (!/\{n\d*\}/.test(from)) continue
    if (!patterns.has(from)) patterns.set(from, from)
  }

  // template literal เดี่ยว ๆ ที่มีคำอ่านออก (เช่น `${n} files`) — เก็บเมื่อมีคีย์ UI อยู่หน้า
  for (const m of src.matchAll(/(?:children|label|text|title|message|placeholder|tooltip|hint|description)\s*:\s*`([^`$]*\$\{[^`]*`)/g)) {
    const raw = m[1]
    let idx = 0
    const withSlots = raw.replace(/\$\{[^}]*\}/g, () => '{n' + (idx++ ? idx : '') + '}')
    const from = unescapeJs(withSlots)
    if (!/\{n\d*\}/.test(from)) continue
    if (!looksLikeUiText(from.replace(/\{n\d*\}/g, 'x'))) continue
    if (!patterns.has(from)) patterns.set(from, from)
  }

  // อาร์เรย์ของข้อความที่ตามหลังคีย์ UI: actions: ["Cancel", "Delete"]
  const arrRe = new RegExp('(?:' + keysAlt + '|actions|options|items|buttons|choices|steps|tabs)"?\\s*:\\s*\\[([^\\]]{0,800})\\]', 'g')
  for (const m of src.matchAll(arrRe)) {
    for (const lit of scanStringLiterals(m[1])) if (!lit.hasSubstitution) add(lit.value)
  }

  // ข้อความใน new Error("...") / throw "..." ที่ orchestrator ส่งขึ้น UI
  for (const m of src.matchAll(/new (?:[A-Za-z]*Error|Error)\(\s*"((?:[^"\\]|\\.)*)"/g)) add(unescapeJs(m[1]))

  return { strings, patterns }
}

/** ไฟล์ที่เก็บข้อความ UI ในแอพ (เมื่อไม่ระบุ path) */
function autoFindBundles() {
  const roots = []
  const local = process.env.LOCALAPPDATA || ''
  if (local) {
    roots.push(path.join(local, 'Programs', '@codebufffreebuff-desktop'))
    roots.push(path.join(local, 'Freebuff-Clones'))
  }
  const found = []
  for (const root of roots) {
    let entries = []
    try { entries = fs.readdirSync(root, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const uiDir = e.isDirectory()
        ? path.join(root, e.name, 'resources', 'orchestrator', 'ui')
        : path.join(root, 'resources', 'orchestrator', 'ui')
      if (!fs.existsSync(uiDir)) continue
      for (const f of fs.readdirSync(path.join(uiDir, 'assets'))) {
        if (/^index-.*\.js$/.test(f)) found.push(path.join(uiDir, 'assets', f))
      }
    }
  }
  return found
}

function extract(files, mode = 'all') {
  const counts = new Map()
  const patternCounts = new Map()
  const seen = new Set() // ข้าม bundle ที่เนื้อหาซ้ำ (main + clones ใช้ไฟล์เดียวกัน)
  // ปรับรหัสเพี้ยนทันทีที่อ่าน (ไฟล์ของสำเนา/clone อาจถูกเขียนทับแบบ UTF-8 → Latin-1)
  const fixEncoding = require('./gap-report.js').fixEncoding
  for (const file of files) {
    const src = fixEncoding(fs.readFileSync(file, 'utf8'))
    const key = require('node:crypto').createHash('sha1').update(src).digest('hex')
    if (seen.has(key)) continue
    seen.add(key)
    if (mode === 'objects') {
      const r = scanUiObjects(src)
      for (const [k, v] of r.strings) counts.set(k, (counts.get(k) || 0) + v)
      for (const [k, v] of r.patterns) patternCounts.set(k, (patternCounts.get(k) || 0) + v)
      continue
    }
    if (mode === 'jsx') {
      for (const [k, v] of scanJsxStrings(src)) counts.set(k, (counts.get(k) || 0) + v)
      continue
    }
    for (const lit of scanStringLiterals(src)) {
      if (lit.hasSubstitution) continue
      const v = lit.value.trim()
      if (!looksLikeUiText(v)) continue
      counts.set(v, (counts.get(v) || 0) + 1)
    }
    if (mode === 'all') {
      for (const [k, v] of scanUiObjects(src).patterns) patternCounts.set(k, (patternCounts.get(k) || 0) + v)
    }
  }
  counts.patterns = patternCounts
  return counts
}

function main() {
  const argv = process.argv.slice(2)
  const jsonIdx = argv.indexOf('--json')
  const outJson = jsonIdx !== -1 ? argv[jsonIdx + 1] : null
  const mode = argv.includes('--jsx') ? 'jsx' : argv.includes('--objects') ? 'objects' : 'all'
  let files = [...new Set(argv.filter((a) => !a.startsWith('--') && a !== outJson))]
  if (argv.includes('--auto') || files.length === 0) files = [...new Set(autoFindBundles())]
  if (files.length === 0) {
    console.error('ไม่พบไฟล์ bundle ของ UI — ระบุ path เองได้: node extract-strings.js <bundle.js>')
    process.exit(1)
  }
  const counts = extract(files, mode)
  const patterns = counts.patterns instanceof Map ? counts.patterns : new Map()
  const sorted = [...counts.entries()]
    .filter(([k]) => k !== 'patterns')
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const result = {
    generatedAt: new Date().toISOString(),
    mode,
    sources: files,
    total: sorted.length,
    strings: Object.fromEntries(sorted.map(([k, v]) => [k, v])),
    patterns: Object.fromEntries([...patterns.entries()].sort((a, b) => b[1] - a[1])),
  }
  if (outJson) {
    fs.mkdirSync(path.dirname(path.resolve(outJson)), { recursive: true })
    fs.writeFileSync(outJson, JSON.stringify(result, null, 2) + '\n', 'utf8')
    console.log(`เขียน ${sorted.length} ข้อความไปที่ ${outJson}`)
    if (patterns.size) console.log(`พบรูปแบบที่ยังไม่แปล (ข้อความที่มีตัวแปร): ${patterns.size}`)
    console.log(`แหล่งที่มา: ${files.join(', ')}`)
  } else {
    for (const [s, c] of sorted) console.log(`${String(c).padStart(4)}  ${s}`)
    console.log(`--- ${sorted.length} ข้อความ`)
  }
}

if (require.main === module) main()
module.exports = { scanStringLiterals, scanJsxStrings, looksLikeUiText, extract, autoFindBundles }
