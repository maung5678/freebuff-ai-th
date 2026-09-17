#!/usr/bin/env node
/**
 * check-dict.js — ตรวจความสอดคล้องของพจนานุกรมกับตัวแอพจริง
 *
 * ใช้:
 *   node fbth/tools/check-dict.js                     # ตรวจกับทุก install ที่เจอบนเครื่องนี้
 *   node fbth/tools/check-dict.js <bundle.js>          # ตรวจกับไฟล์ที่ระบุ
 *   node fbth/tools/check-dict.js --strict             # exit code 1 ถ้ามีคำที่หลุด (ใช้ในสคริปต์อัตโนมัติ)
 *   node fbth/tools/check-dict.js --todo-json <path>   # เขียนรายการที่ยังไม่แปลเป็น JSON (ไว้ทำงานต่อ)
 *
 * ตรวจอะไร
 *   1. ทุกคีย์ในพจนานุกรมต้องมีอยู่ในบันเดิลจริง (กันคำที่พิมพ์ผิด/ตกค้างหลังอัปเดต)
 *   2. คีย์ซ้ำกันข้ามไฟล์พจนานุกรม (merge ทีหลังทับตัวก่อน)
 *   3. คำที่ยังไม่ถูกแปลจาก candidates-jsx.json (ใช้เป็นรายการงานสำหรับ AI/คน)
 *   4. pattern/phrase ที่ผิดรูปแบบ
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { autoFindBundles } = require('./extract-strings.js')

// ตัวปรับข้อความที่ถูกรหัสเพี้ยน (ใช้ตารางเดียวกับ runtime และ gap-report)
let fixEncoding = (s) => s
let fixEncodingReady = true
try { ({ fixEncoding } = require('./gap-report.js')) } catch (e) { fixEncodingReady = false }

const ROOT = path.resolve(__dirname, '..')

function loadMergedDict() {
  const dir = path.join(ROOT, 'dict')
  const files = fs.readdirSync(dir).filter((f) => /^th.*\.json$/.test(f)).sort((a, b) => {
    // th.json เป็นฐานเสมอ ไฟล์อื่นต่อท้ายตามชื่อ
    if (a === 'th.json') return -1
    if (b === 'th.json') return 1
    return a.localeCompare(b)
  })
  const merged = { meta: {}, strings: {}, patterns: [], phrases: {} }
  const perKey = new Map()
  for (const f of files) {
    let data
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    } catch (e) {
      console.error(`✖ อ่าน ${f} ไม่ได้: ${e.message}`)
      continue
    }
    for (const [k, v] of Object.entries(data.strings || {})) {
      if (perKey.has(k) && perKey.get(k) !== f) {
        console.warn(`! คีย์ซ้ำ: ${JSON.stringify(k)} อยู่ในทั้ง ${perKey.get(k)} และ ${f} (ใช้ค่าจาก ${f})`)
      }
      perKey.set(k, f)
      merged.strings[k] = v
    }
    if (Array.isArray(data.patterns)) merged.patterns.push(...data.patterns)
    Object.assign(merged.phrases, data.phrases || {})
    Object.assign(merged.meta, data.meta || {})
  }
  return { merged, files }
}

/** คีย์ต้องปรากฏในบันเดิลอย่างน้อยหนึ่งรูปแบบ (มี/ไม่มี escape) */
function keyLooksPresent(src, key) {
  // ข้อความดิบ: ครอบคลุมกรณีที่ข้อความถูกรวมกับสตริงอื่น (เช่น "Configuration name: ")
  // และ runtime ตัดช่องว่างหัว-ท้ายก่อนเทียบอยู่แล้ว
  if (src.includes(key)) return true
  const variants = new Set([
    JSON.stringify(key),                     // "คีย์"
    "'" + key.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'",  // 'คีย์'
    '`' + key + '`',
  ])
  // คีย์ที่มี “ ” ’ เป็นอักขระปกติ ไม่ต้อง escape เพิ่ม
  for (const v of variants) if (src.includes(v)) return true
  // เผื่อกรณี escape unicode ในโค้ด
  const esc = key.replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  if (esc !== key && src.includes(JSON.stringify(esc))) return true
  return false
}

/**
 * รวม "แหล่งข้อความ" ทั้งหมดที่พจนานุกรมต้องอ้างถึงได้
 *   1) บันเดิล UI (index-*.js)
 *   2) orchestrator.js (ทูลทิปสกิล/ข้อความ error ที่ผู้ใช้เห็น)
 *   3) ไฟล์ .js/.cjs ใน app.asar (เมนู/dialog ฝั่ง main process)
 * ใช้ร่วมกับ dict-tools.js (prune) เพื่อให้ตัวเลข "คีย์ตาย" ของทุกเครื่องมือตรงกัน
 */
function collectDictionarySources(bundles) {
  const orchSources = []
  for (const b of bundles) {
    const orch = path.resolve(path.dirname(b), '..', '..', 'orchestrator.js')
    if (fs.existsSync(orch) && !orchSources.includes(orch)) orchSources.push(orch)
  }
  const sources = [
    // ปรับรหัสเพี้ยนก่อนตรวจ (ไฟล์ของสำเนา/clone อาจถูกเขียนทับแบบ UTF-8 → Latin-1)
    ...bundles.map((b) => ({ path: b, src: fixEncoding(fs.readFileSync(b, 'utf8')) })),
    ...orchSources.map((o) => ({ path: o, src: fixEncoding(fs.readFileSync(o, 'utf8')) })),
  ]
  // ไฟล์ของ main process ใน asar (ชื่อ filter ใน dialog, ข้อความที่ UI ไม่มี)
  const asarJs = []
  for (const b of bundles.slice(0, 1)) {
    const asarPath = path.resolve(path.dirname(b), '..', '..', '..', 'app.asar')
    if (!fs.existsSync(asarPath)) continue
    try {
      const { openAsar } = require('../lib/asar.js')
      const asar = openAsar(asarPath)
      for (const f of asar.list().filter((x) => /\.(cjs|mjs|js)$/.test(x) && !/node_modules\//.test(x))) {
        const buf = asar.readFile(f)
        if (buf) asarJs.push({ path: asarPath + '!' + f, src: fixEncoding(buf.toString('utf8')) })
      }
      asar.close()
    } catch (e) { /* ข้าม */ }
  }
  sources.push(...asarJs)

  // ข้อความ UI ที่อยู่ใน orchestrator.js และผู้ใช้เห็นจริง (ทูลทิปชิปสกิล + ข้อความ error ของระบบสกิล)
  // บางส่วนถูก "ประกอบ" ขึ้นมา (ตัดทอน/ต่อบรรทัด) จึงต้องคำนวณด้วยตัวเดียวกับที่สร้างพจนานุกรม
  let orchestratorUi = { strings: new Map(), patterns: new Map(), missingFromSource: [], chipMax: 0, sources: orchSources, error: null }
  try {
    orchestratorUi = require('./extract-orchestrator-strings.js').collectFromInstalls(bundles)
  } catch (e) {
    console.warn(`! ตรวจข้อความจาก orchestrator ไม่ได้: ${e.message}`)
  }
  return { sources, orchSources, asarJs, orchestratorUi }
}

function main() {
  const argv = process.argv.slice(2)
  const strict = argv.includes('--strict')
  const todoJsonIdx = argv.indexOf('--todo-json')
  const todoOutPath = todoJsonIdx !== -1 ? argv[todoJsonIdx + 1] : null
  const skipIdx = new Set([todoJsonIdx, todoJsonIdx + 1].filter((i) => i >= 0))
  const positional = argv.filter((a, i) => !a.startsWith('--') && !skipIdx.has(i))
  const bundles = positional.length ? positional : [...new Set(autoFindBundles())]
  if (!bundles.length) {
    console.error('ไม่พบบันเดิล UI ของ Freebuff — ระบุ path เองได้')
    process.exit(1)
  }

  const { merged, files } = loadMergedDict()
  // ข้อความบางคำ (เช่น ป้ายราคา/สถานะ) อยู่ใน orchestrator ไม่ใช่ bundle ของ UI → ต้องค้นทั้งสองที่
  const { sources, orchSources, orchestratorUi } = collectDictionarySources(bundles)
  const derivedStrings = new Set(orchestratorUi.strings.keys())

  const keys = Object.keys(merged.strings)
  const missing = keys.filter((k) => !derivedStrings.has(k) && !sources.some((s) => keyLooksPresent(s.src, k)))

  console.log(`พจนานุกรม: ${files.join(', ')}`)
  console.log(`  คีย์: ${keys.length} · pattern: ${merged.patterns.length} · phrase: ${Object.keys(merged.phrases).length}`)
  console.log(`  บันเดิลที่ตรวจ: ${bundles.length} ไฟล์`)
  console.log(`  คีย์ที่ไม่พบบันเดิล: ${missing.length}`)
  for (const k of missing.slice(0, 80)) console.log(`    - ${JSON.stringify(k)}`)
  if (missing.length > 80) console.log(`    … และอีก ${missing.length - 80} คำ`)

  // ตรวจ pattern: placeholder ต้องมีคู่กันทั้ง from/to
  const badPatterns = []
  // รูปแบบกว้างเกินไป/ไม่ทำอะไร จะกวาดข้อความทั้ง UI แล้วคืนค่าเดิม → บังการแปลแบบอื่นทั้งหมด
  let badPatternReason = () => null
  try { ({ badPatternReason } = require('./gap-report.js')) } catch (e) { /* ข้ามการตรวจนี้ */ }
  for (const p of merged.patterns) {
    const reason = badPatternReason(p)
    if (reason) badPatterns.push(`${JSON.stringify(p.from)} → ${JSON.stringify(p.to)} (${reason})`)
    const fromNames = [...String(p.from).matchAll(/\{([a-zA-Z0-9_]+)(?::[^}]*)?\}/g)].map((m) => m[1])
    const toNames = [...String(p.to).matchAll(/\{([a-zA-Z0-9_]+)(?::[^}]*)?\}/g)].map((m) => m[1])
    for (const n of toNames) if (!fromNames.includes(n)) badPatterns.push(`${JSON.stringify(p.from)} → ${JSON.stringify(p.to)} (ไม่มี {${n}} ใน from)`)
    let re = null
    try {
      const body = String(p.from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{([a-zA-Z0-9_]+)(?::[^}]*)?\\\}/g, '([\\s\\S]+?)')
      re = new RegExp('^' + body + '$')
    } catch (e) { badPatterns.push(`${JSON.stringify(p.from)} (regex ใช้ไม่ได้)`) }
    if (re && !re.test(String(p.from).replace(/\{([a-zA-Z0-9_]+)(?::[^}]*)?\}/g, (_, n) => (n === 'n' || n === 'total' ? '3' : 'x')))) {
      badPatterns.push(`${JSON.stringify(p.from)} (regex ไม่จับกับตัวเอง)`)
    }
  }
  console.log(`  pattern ที่ผิดรูปแบบ: ${badPatterns.length}`)
  for (const b of badPatterns) console.log(`    - ${b}`)

  // ── ข้อความ UI ที่มาจาก orchestrator (สกิล) ────────────────────────────────
  const orchKeys = [...orchestratorUi.strings.keys()]
  const orchMissing = orchKeys.filter((k) => !(k in merged.strings))
  const knownPatterns = new Set(merged.patterns.map((p) => String(p.from)))
  const orchPatternMissing = [...orchestratorUi.patterns.keys()].filter((p) => !knownPatterns.has(p))
  if (orchKeys.length) {
    console.log(`  ข้อความ UI ของ orchestrator (สกิล ${orchestratorUi.chipMax} ตัวอักษร): ${orchKeys.length} คำ · ยังไม่แปล: ${orchMissing.length}`)
    for (const k of orchMissing.slice(0, 15)) console.log(`    - ${JSON.stringify(k)}`)
    if (orchMissing.length > 15) console.log(`    … และอีก ${orchMissing.length - 15} คำ (ดูล้วน: node fbth/tools/extract-orchestrator-strings.js --list)`)
    console.log(`  pattern ของ orchestrator: ${orchestratorUi.patterns.size} · ยังไม่มีคำแปล: ${orchPatternMissing.length}`)
    for (const p of orchPatternMissing.slice(0, 10)) console.log(`    - ${JSON.stringify(p)}`)
  }
  if (orchestratorUi.missingFromSource && orchestratorUi.missingFromSource.length) {
    const uniq = [...new Set(orchestratorUi.missingFromSource)]
    console.log(`  ! ข้อความที่เครื่องมือคาดไว้ไม่พบใน orchestrator (แอพอัปเดตถ้อยคำ?): ${uniq.length}`)
    for (const m of uniq.slice(0, 10)) console.log(`    - ${JSON.stringify(m)}`)
  }

  // งานที่ยังเหลือ: ข้อความที่สแกนได้จากแอพแต่ยังไม่มีคำแปล (ใช้ตัวกรองเดียวกับ gap-report)
  let relevant = (s) => !!s
  try { ({ relevant } = require('./gap-report.js')) } catch (e) { /* ใช้ตัวกรองเริ่มต้น */ }
  // ใช้เฉพาะไฟล์ candidates ที่สแกนแบบเลือกเฉพาะข้อความ UI (ไม่รวมโหมด --all ที่ปน internals)
  const candidateFiles = fs.readdirSync(path.join(ROOT, 'dict'))
    .filter((f) => /^candidates-(jsx|ui-objects|objects)\.json$/.test(f))
  const todo = new Set()
  for (const f of candidateFiles) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'dict', f), 'utf8'))
      for (const raw of Object.keys(j.strings || {})) {
        const s = fixEncoding(raw)
        if (s in merged.strings) continue
        if (s in (merged.phrases || {})) continue
        if (!relevant(s)) continue
        todo.add(s)
      }
    } catch (e) { /* ข้ามไฟล์ที่อ่านไม่ได้ */ }
  }
  console.log(`  ข้อความที่ยังไม่แปล (รวมทุกไฟล์ candidates, หักชื่อภาษา/แบรนด์/ภายในแล้ว): ${todo.size}`)
  for (const t of [...todo].slice(0, 15)) console.log(`    - ${JSON.stringify(t)}`)
  if (todo.size > 15) console.log(`    … และอีก ${todo.size - 15} คำ (ดูทั้งหมด: node fbth/tools/gap-report.js fbth/dict/candidates-ui-objects.json --limit 200)`)
  if (todo.size) missing.push(...[...todo].map((t) => `[ui] ${t}`))
  if (orchMissing.length) missing.push(...orchMissing.map((t) => `[orch] ${t}`))
  if (orchPatternMissing.length) missing.push(...orchPatternMissing.map((p) => `[orch-pattern] ${p}`))

  // pattern ที่มีตัวแปรแต่ยังไม่มีคำแปล (ใช้ไฟล์ candidates ชุดเดียวกัน)
  const patternGaps = new Set()
  {
    let isOverbroadPattern = () => false
    try { ({ isOverbroadPattern } = require('./gap-report.js')) } catch (e) { /* ข้าม */ }
    const known = new Set(merged.patterns.map((p) => String(p.from)))
    for (const f of candidateFiles) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'dict', f), 'utf8'))
        // รูปแบบหลอกที่ตัวสแกนสร้างขึ้น (เช่น "{n} {n2}{n3}") ไม่นับเป็นงานที่ต้องแปล
        for (const p of Object.keys(j.patterns || {})) if (!known.has(p) && !isOverbroadPattern(p)) patternGaps.add(p)
      } catch (e) { /* ข้าม */ }
    }
  }
  // ส่งออกเป็น JSON ให้งานแปลรอบถัดไปดึงไปใช้ต่อได้
  if (todoOutPath) {
    fs.writeFileSync(path.resolve(todoOutPath), JSON.stringify({
      generatedAt: new Date().toISOString(),
      total: todo.size + orchMissing.length,
      gaps: [...todo].sort(),
      patternGaps: [...patternGaps].sort(),
      orchestratorGaps: orchMissing,
      orchestratorPatternGaps: orchPatternMissing,
    }, null, 2) + '\n', 'utf8')
    console.log(`  เขียนรายการงานที่เหลือไปที่: ${todoOutPath} (${todo.size} คำ · orchestrator ${orchMissing.length} คำ · pattern ${patternGaps.size + orchPatternMissing.length})`)
  }

  // ── พจนานุกรมของ shell (เมนู native / dialog) ────────────────────────────
  const shellDictPath = path.join(ROOT, 'dict', 'shell-th.json')
  if (fs.existsSync(shellDictPath)) {
    const shellDict = JSON.parse(fs.readFileSync(shellDictPath, 'utf8'))
    const shellSrc = []
    for (const b of bundles) {
      // b = <install>/resources/orchestrator/ui/assets/index-*.js → ถอย 4 ระดับให้ถึง resources
      const asarPath = path.resolve(path.dirname(b), '..', '..', '..', 'app.asar')
      if (!fs.existsSync(asarPath)) continue
      try {
        const { openAsar } = require('../lib/asar.js')
        const asar = openAsar(asarPath)
        for (const f of asar.list().filter((x) => /electron[\\/].*\.(cjs|html)$/.test(x))) {
          const buf = asar.readFile(f)
          if (buf) shellSrc.push(fixEncoding(buf.toString('utf8')))
        }
        asar.close()
      } catch (e) { /* ข้าม */ }
    }
    const shellKeys = Object.keys(shellDict.strings || {})
    // คีย์ของเมนูที่ Electron สร้างให้เอง (role) ไม่ปรากฏเป็นข้อความในซอร์ส → ยกเว้น
    const ROLE_LABELS = new Set(['Edit', 'Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Paste and Match Style', 'Delete', 'Select All',
      'Toggle Developer Tools', 'Actual Size', 'Zoom In', 'Zoom Out', 'Toggle Full Screen', 'Minimize', 'Zoom', 'Close Window',
      'Services', 'Hide Others', 'Show All', 'Bring All to Front', 'About Freebuff',
      // ป้ายที่ Electron สร้างเองในเมนูดีฟอลต์ (ไม่ปรากฏในซอร์สของแอพ แต่โชว์ได้ถ้าแอพยังไม่ตั้งเมนู)
      'Reload', 'Force Reload', 'Exit', 'Help', 'File', 'View', 'Window', 'Quit', 'Close', 'Hide',
      'Learn More', 'About', 'Preferences', "Don't Save", 'Choose', 'Later', 'Install', 'Download',
      'OK', 'Yes', 'No', 'Are you sure?'])
    const shellMissing = shellKeys.filter((k) => {
      if (ROLE_LABELS.has(k)) return false
      if (/^[A-Za-z]+$/.test(k) && k.length <= 4) return false // Attach/Open/Save/…
      return !shellSrc.some((s) => s.includes(k))
    })
    console.log(`  shell dict: ${shellKeys.length} คีย์ · ไม่พบในซอร์สของ shell: ${shellMissing.length}`)
    for (const k of shellMissing.slice(0, 30)) console.log(`    - ${JSON.stringify(k)}`)
    if (shellMissing.length) missing.push(...shellMissing.map((k) => `[shell] ${k}`))
  }

  if (missing.length || badPatterns.length) {
    console.log('\nคำแนะนำ: คำที่ไม่พบบันเดิลมักเกิดจาก (ก) อัปเดตแอพแล้วข้อความเปลี่ยน → ลบออก หรือ (ข) สะกดไม่ตรง → แก้คีย์')
    if (strict) process.exit(1)
  }
}

if (require.main === module) main()
module.exports = { loadMergedDict, keyLooksPresent, collectDictionarySources }
