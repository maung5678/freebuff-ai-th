#!/usr/bin/env node
/**
 * fbth.js — ตัวติดตั้ง/ถอด/ตรวจสอบ "การแปลไทย" ให้แอพ Freebuff Desktop
 *
 *   node fbth/fbth.js install            # ติดตั้ง/อัปเดตการแปลให้ทุกที่ติดตั้งที่เจอ
 *   node fbth/fbth.js install --dry-run  # ลองก่อน ไม่แก้ไฟล์
 *   node fbth/fbth.js uninstall          # ถอดออก คืนค่า index.html เดิม
 *   node fbth/fbth.js status             # ดูสถานะ + ตรวจว่ามีคำใหม่จากอัปเดตแอพหรือยัง
 *   node fbth/fbth.js ensure             # ติดตั้งถ้ายังไม่ได้ติดตั้ง หรือพจนานุกรมใหม่กว่า (ใช้โดยตัวเรียกแอพ)
 *   node fbth/fbth.js launch             # ensure แล้วเปิดแอพ Freebuff ให้เลย (ใช้โดย "เปิด Freebuff ไทย.cmd")
 *   node fbth/fbth.js where              # บอกว่าพบที่ติดตั้ง/สำเนาที่ไหนบ้าง
 *   node fbth/fbth.js bench              # เตรียมไฟล์สำหรับหน้าทดสอบ dev/bench.html
 *
 * ตัวเลือก
 *   --app <path>   ระบุโฟลเดอร์ติดตั้งเอง (ชี้ไปที่โฟลเดอร์ที่มี resources/orchestrator/ui)
 *   --all          ทุกที่ติดตั้ง (ค่าเริ่มต้น)
 *   --main         เฉพาะตัวติดตั้งหลัก
 *   --clones       เฉพาะสำเนา (Freebuff-Clones/*)
 *   --quiet        เงียบ (สำหรับตัวเรียกแอพ)
 *
 * วิธีทำงาน (ไม่แก้โค้ดแอพเลย)
 *   1. merge พจนานุกรม dict/th*.json → <ui>/fbth-dict.json
 *   2. คัดลอก fbth/runtime/fbth-th.js → <ui>/fbth-th.js
 *   3. แทรก <script defer src="./fbth-th.js"></script> ลง <ui>/index.html (สำรองไฟล์เดิมไว้)
 *   ขั้นที่ 1-2 เขียนทับได้ทุกรอบ → อัปเดตคำแปลโดยไม่ต้องแก้ index.html ซ้ำ
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const PROJECT_ROOT = path.resolve(__dirname, '..')  // โฟลเดอร์โปรเจกต์ (Freebuff AI TH)
const RUNTIME_SRC = path.join(__dirname, 'runtime', 'fbth-th.js')
const DICT_DIR = path.join(__dirname, 'dict')
const SHELL_SRC_DIR = path.join(__dirname, 'shell')
const SHELL_DICT_SRC = path.join(DICT_DIR, 'shell-th.json')

// โฟลเดอร์ที่เราสร้างในแอพ (เก็บไฟล์ของ fbth ทั้งหมดของ shell) + marker สำหรับตรวจว่าแทรกแล้ว
const APP_FBTH_DIR = 'fbth'
const SHELL_MARKER = 'fbth-shell-inject'
const SHELL_INJECT = ";require(process.resourcesPath+'/fbth/shell.cjs');//" + SHELL_MARKER + '\n'

const MARKER = '<!-- fbth:th -->'
const SCRIPT_TAG = '<script defer src="./fbth-th.js"></script>'
const BACKUP_SUFFIX = '.fbth-original'
const STATE_SUFFIX = '.fbth-state.json'
const LOCALE_TITLE = 'Freebuff เดสก์ท็อป'

// ── ตัวช่วย ──────────────────────────────────────────────────────────────────
const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
}

function log(quiet, ...args) {
  if (!quiet) console.log(...args)
}

function readJsonSafe(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return fallback }
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)
}

/** hash ของ "เนื้อหา" พจนานุกรม (ไม่รวม meta ที่เปลี่ยนทุกครั้ง เช่น generatedAt) */
function dictContentHash(dict) {
  if (!dict) return null
  return sha1(JSON.stringify({ strings: dict.strings, phrases: dict.phrases, patterns: dict.patterns }))
}

/** hash ของพจนานุกรมที่ติดตั้งอยู่บนดิสก์ (เทียบแบบเนื้อหา ไม่ใช่ไบต์) */
function storedDictHash(uiDir) {
  return dictContentHash(readJsonSafe(path.join(uiDir, 'fbth-dict.json')))
}

/** หาที่ติดตั้งทั้งหมด (ตัวหลัก + สำเนา) */
function findInstalls() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const candidates = []
  const main = path.join(local, 'Programs', '@codebufffreebuff-desktop')
  if (fs.existsSync(main)) candidates.push({ kind: 'main', root: main, name: 'Freebuff (ตัวหลัก)' })

  const clonesRoot = path.join(local, 'Freebuff-Clones')
  if (fs.existsSync(clonesRoot)) {
    for (const entry of fs.readdirSync(clonesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (/ Profile$/i.test(entry.name)) continue
      const root = path.join(clonesRoot, entry.name)
      if (!fs.existsSync(path.join(root, 'resources'))) continue
      candidates.push({ kind: 'clone', root, name: entry.name })
    }
  }
  return candidates.filter((i) => fs.existsSync(path.join(uiDirOf(i.root), 'index.html')))
}

function uiDirOf(root) {
  return path.join(root, 'resources', 'orchestrator', 'ui')
}

/** เลือกที่ติดตั้งตามตัวเลือก --app/--main/--clones */
function selectInstalls(opts) {
  if (opts.app) return [{ kind: 'custom', root: opts.app, name: opts.app }]
  const all = findInstalls()
  if (opts.main) return all.filter((i) => i.kind === 'main')
  if (opts.clones) return all.filter((i) => i.kind === 'clone')
  return all
}

/** fingerprint ของ UI ที่ติดตั้งอยู่ (ไว้ตรวจว่าแอพอัปเดตหรือยัง) */
function uiFingerprint(uiDir) {
  const assetsDir = path.join(uiDir, 'assets')
  let mainBundle = null
  try {
    const f = fs.readdirSync(assetsDir).filter((n) => /^index-.*\.js$/.test(n)).sort().join(',')
    mainBundle = f
  } catch (e) {}
  const indexPath = path.join(uiDir, 'index.html')
  const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath) : Buffer.alloc(0)
  const htmlClean = html.toString('utf8').replace(MARKER, '').replace(SCRIPT_TAG, '')
  return { bundle: mainBundle, htmlHash: sha1(Buffer.from(htmlClean)), appVersion: readAppVersion(uiDir) }
}

function readAppVersion(uiDir) {
  // version ของแอพอยู่ใน resources/app.asar (อ่านแบบเบา ๆ จาก package.json ของ clone ที่แตกไว้ ถ้ามี)
  const root = path.resolve(uiDir, '..', '..', '..')
  const p = path.join(root, 'resources', 'app', 'package.json')
  const j = readJsonSafe(p)
  return j && j.version ? j.version : null
}

// ── พจนานุกรม ────────────────────────────────────────────────────────────────
function loadDictionaries() {
  const files = fs.readdirSync(DICT_DIR)
    .filter((f) => /^th[\w.-]*\.json$/.test(f) && !/^th-(removed|backup)/.test(f))
    .sort((a, b) => (a === 'th.json' ? -1 : b === 'th.json' ? 1 : a.localeCompare(b)))
  const merged = { meta: { locale: 'th', runtime: 1 }, strings: {}, phrases: {}, patterns: [] }
  const seenPatterns = new Set()
  const usedFiles = []
  for (const f of files) {
    const data = readJsonSafe(path.join(DICT_DIR, f))
    if (!data) continue
    usedFiles.push(f)
    Object.assign(merged.strings, data.strings || {})
    Object.assign(merged.phrases, data.phrases || {})
    for (const p of data.patterns || []) {
      const key = String(p.from)
      if (seenPatterns.has(key)) continue
      seenPatterns.add(key)
      merged.patterns.push(p)
    }
    Object.assign(merged.meta, data.meta || {})
  }
  merged.meta.files = usedFiles
  merged.meta.counts = {
    strings: Object.keys(merged.strings).length,
    phrases: Object.keys(merged.phrases).length,
    patterns: merged.patterns.length,
  }
  merged.meta.generatedAt = new Date().toISOString()
  return merged
}

// ── แก้ index.html ───────────────────────────────────────────────────────────
const STATIC_REPLACEMENTS = [
  ['<title>Freebuff Desktop</title>', `<title>${LOCALE_TITLE}</title>`],
  // รองรับทั้ง `’` ปกติ และแบบเพี้ยนรหัส `â€™` (สำเนาแอพที่ถูกสคริปต์ PowerShell เขียนทับ)
  [/<h1>Freebuff couldn.{0,6}t load<\/h1>/g, '<h1>โหลด Freebuff ไม่สำเร็จ</h1>'],
  [/Part of the interface did not start\.\s+Reload once; if this screen returns, reinstall the\s+latest version\. Your projects and conversations are safe\./g,
   'บางส่วนของอินเทอร์เฟซไม่เริ่มทำงาน ลองโหลดใหม่หนึ่งครั้ง หากยังเห็นหน้าจอนี้ ให้ติดตั้งเวอร์ชันล่าสุดใหม่อีกครั้ง โปรเจกต์และบทสนทนาของคุณยังปลอดภัย'],
  ['Reload Freebuff', 'โหลด Freebuff ใหม่'],
  ['Get latest installer', 'ดาวน์โหลดตัวติดตั้งล่าสุด'],
]

function patchIndexHtml(html) {
  if (html.includes(MARKER)) return { html, changed: false, already: true }
  let out = html
  for (const [from, to] of STATIC_REPLACEMENTS) {
    if (from instanceof RegExp) out = out.replace(from, to)
    else if (out.includes(from)) out = out.split(from).join(to)
  }
  const tag = `    ${SCRIPT_TAG}\n    ${MARKER}\n`
  const idx = out.lastIndexOf('</body>')
  if (idx === -1) out = out + '\n' + tag
  else out = out.slice(0, idx) + tag + out.slice(idx)
  return { html: out, changed: true, already: false }
}

function unpatchIndexHtml(html) {
  let out = html
  out = out.split(SCRIPT_TAG).join('').split(MARKER).join('')
  // คืนข้อความ static ที่เราแปลไว้ ให้ตรงกับต้นฉบับ (ข้อความที่มี regex ใช้การสำรองไฟล์แทน)
  for (const [from, to] of STATIC_REPLACEMENTS) {
    if (from instanceof RegExp) continue
    out = out.split(to).join(from)
  }
  return out
}

// ── คำสั่งหลัก ───────────────────────────────────────────────────────────────
function cmdInstall(opts) {
  const dict = loadDictionaries()
  const dictBuf = Buffer.from(JSON.stringify(dict))
  const runtimeBuf = fs.readFileSync(RUNTIME_SRC)
  const dictHash = dictContentHash(dict)
  const runtimeHash = sha1(runtimeBuf)

  const installs = selectInstalls(opts)

  if (!installs.length) {
    console.error(c.err('ไม่พบที่ติดตั้ง Freebuff'))
    return 1
  }

  // --shell-only : ทำเฉพาะเมนู native/dialog
  if (opts.shellOnly) {
    const n = installShellFor(opts, installs)
    if (!opts.quiet) console.log('\nเสร็จ: ปิดแล้วเปิดแอพใหม่ (หรือ Ctrl+R) เพื่อดูเมนูภาษาไทย')
    return n ? 1 : 0
  }

  log(opts.quiet, `พจนานุกรม: ${dict.meta.files.join(', ')} · ${dict.meta.counts.strings} คำ · pattern ${dict.meta.counts.patterns}`)
  let failures = 0

  for (const inst of installs) {
    const uiDir = uiDirOf(inst.root)
    const indexPath = path.join(uiDir, 'index.html')
    const backupPath = indexPath + BACKUP_SUFFIX
    const statePath = indexPath + STATE_SUFFIX
    const fp = uiFingerprint(uiDir)
    const prevState = readJsonSafe(statePath, null)

    try {
      if (!fs.existsSync(indexPath)) throw new Error('ไม่พบ index.html')

      const original = fs.readFileSync(indexPath, 'utf8')
      const { html: patched, already } = patchIndexHtml(original)

      const runtimeChanged = !fs.existsSync(path.join(uiDir, 'fbth-th.js')) ||
        sha1(fs.readFileSync(path.join(uiDir, 'fbth-th.js'))) !== runtimeHash
      const dictChanged = storedDictHash(uiDir) !== dictHash
      const htmlChanged = !already

      const drift = prevState && prevState.fingerprint && prevState.fingerprint.bundle !== fp.bundle
      const status = []
      if (htmlChanged) status.push('แทรกสคริปต์ใน index.html')
      if (runtimeChanged) status.push('อัปเดต fbth-th.js')
      if (dictChanged) status.push(`อัปเดตพจนานุกรม (${dict.meta.counts.strings} คำ)`)
      if (!status.length) status.push('เป็นเวอร์ชันล่าสุดอยู่แล้ว')
      if (drift) status.push(c.warn(`ตรวจพบแอพอัปเดต (bundle เปลี่ยน: ${prevState.fingerprint.bundle} → ${fp.bundle})`))

      log(opts.quiet, `\n${c.ok('✔')} ${inst.name}`)
      log(opts.quiet, `  ${c.dim(uiDir)}`)
      for (const s of status) log(opts.quiet, `  · ${s}`)

      if (opts.dryRun) {
        log(opts.quiet, c.dim('  (dry-run: ไม่ได้แก้ไฟล์)'))
        continue
      }

      // สำรองต้นฉบับไว้ครั้งเดียว (อย่าเขียนทับด้วยไฟล์ที่ถูก patch แล้ว)
      if (!fs.existsSync(backupPath) && !already) fs.writeFileSync(backupPath, Buffer.from(original, 'utf8'))
      if (htmlChanged) fs.writeFileSync(indexPath, Buffer.from(patched, 'utf8'))
      if (runtimeChanged) fs.copyFileSync(RUNTIME_SRC, path.join(uiDir, 'fbth-th.js'))
      if (dictChanged) fs.writeFileSync(path.join(uiDir, 'fbth-dict.json'), dictBuf)
      fs.writeFileSync(statePath, JSON.stringify({
        patchedAt: new Date().toISOString(),
        dictHash, runtimeHash,
        dictCounts: dict.meta.counts,
        fingerprint: fp,
      }, null, 2) + '\n')
    } catch (err) {
      failures++
      console.error(`${c.err('✖')} ${inst.name}: ${err.message}`)
    }
  }

  if (opts.rendererOnly !== true) failures += installShellFor(opts, installs)

  if (!opts.quiet) {
    console.log('\nขั้นต่อไป: ปิดแล้วเปิดแอพ Freebuff ใหม่ (หรือกด Ctrl+R ในหน้าต่างแอพ) เพื่อให้เห็นภาษาไทย')
    console.log(`ตรวจสถานะได้ด้วย: node "${path.relative(process.cwd(), __filename)}" status`)
  }
  return failures ? 1 : 0
}

function cmdUninstall(opts) {
  const installs = selectInstalls(opts)
  let failures = 0
  for (const inst of installs) {
    const uiDir = uiDirOf(inst.root)
    const indexPath = path.join(uiDir, 'index.html')
    const backupPath = indexPath + BACKUP_SUFFIX
    try {
      const cur = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null
      if (cur === null) throw new Error('ไม่พบ index.html')
      if (opts.dryRun) { log(opts.quiet, `(dry-run) จะถอดออกจาก ${inst.name}`); continue }
      if (fs.existsSync(backupPath)) {
        fs.copyFileSync(backupPath, indexPath)
        fs.unlinkSync(backupPath)
      } else if (cur.includes(MARKER)) {
        fs.writeFileSync(indexPath, Buffer.from(unpatchIndexHtml(cur), 'utf8'))
      }
      for (const f of ['fbth-th.js', 'fbth-dict.json']) {
        const p = path.join(uiDir, f)
        if (fs.existsSync(p)) fs.unlinkSync(p)
      }
      const statePath = indexPath + STATE_SUFFIX
      if (fs.existsSync(statePath)) fs.unlinkSync(statePath)
      log(opts.quiet, `${c.ok('✔')} ถอดภาษาไทยออกแล้ว: ${inst.name}`)
    } catch (err) {
      failures++
      console.error(`${c.err('✖')} ${inst.name}: ${err.message}`)
    }
  }
  if (opts.rendererOnly !== true) failures += uninstallShellFor(opts, installs)
  if (!opts.quiet) console.log('ปิดแล้วเปิดแอพใหม่เพื่อกลับเป็นภาษาอังกฤษ')
  return failures ? 1 : 0
}

function cmdStatus(opts) {
  const dict = loadDictionaries()
  const dictHash = dictContentHash(dict)
  const runtimeHash = sha1(fs.readFileSync(RUNTIME_SRC))
  const installs = selectInstalls(opts)

  console.log(`พจนานุกรมในเครื่องนี้: ${dict.meta.counts.strings} คำ · pattern ${dict.meta.counts.patterns} · phrase ${dict.meta.counts.phrases}`)
  console.log(`ไฟล์: ${dict.meta.files.join(', ')}`)
  console.log('')

  for (const inst of installs) {
    const uiDir = uiDirOf(inst.root)
    const indexPath = path.join(uiDir, 'index.html')
    const state = readJsonSafe(indexPath + STATE_SUFFIX, null)
    const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : ''
    const fp = uiFingerprint(uiDir)
    const installed = html.includes(MARKER)
    const runtimeOk = fs.existsSync(path.join(uiDir, 'fbth-th.js')) &&
      sha1(fs.readFileSync(path.join(uiDir, 'fbth-th.js'))) === runtimeHash
    const dictOk = storedDictHash(uiDir) === dictHash

    const stateLabel = installed ? c.ok('ติดตั้งแล้ว') : c.warn('ยังไม่ติดตั้ง')
    console.log(`${stateLabel}  ${inst.name}${fp.appVersion ? c.dim(` (แอพ v${fp.appVersion})`) : ''}`)
    console.log(`  index.html: ${installed ? 'มีสคริปต์ fbth' : 'ไม่มีการแก้ไข'}${fs.existsSync(indexPath + BACKUP_SUFFIX) ? ' · มีไฟล์สำรอง' : ''}`)
    console.log(`  fbth-th.js: ${runtimeOk ? c.ok('ตรงกับต้นทาง') : c.warn('เก่า/ไม่มี')} · fbth-dict.json: ${dictOk ? c.ok('ตรงกับต้นทาง') : c.warn('เก่า/ไม่มี')}`)
    if (state) {
      const drift = state.fingerprint && state.fingerprint.bundle !== fp.bundle
      console.log(`  ติดตั้งเมื่อ: ${state.patchedAt}${drift ? c.warn(' · แอพอัปเดตแล้ว (bundle เปลี่ยน) → ควรตรวจคำใหม่') : ''}`)
    }
    if (installed && (!runtimeOk || !dictOk)) console.log(c.warn(`  → รัน "fbth install" เพื่อซิงค์ไฟล์ให้ตรงกับพจนานุกรมล่าสุด`))

    // ส่วน shell (เมนู native / dialog)
    const shellState = readJsonSafe(shellStatePath(inst.root), null)
    const shellDictHash = dictContentHash(loadShellDict())
    const shellFilesOk = ['shell.cjs', 'shell-dict.json', 'renderer.js'].every((f) =>
      fs.existsSync(path.join(shellDirOf(inst.root), f)))
    const shellMarkerOk = shellPatched(inst.root)
    const shellLabel = shellMarkerOk && shellFilesOk ? c.ok('ติดตั้งแล้ว') : c.warn('ยังไม่ติดตั้ง')
    const shellDrift = shellState && shellState.dictHash !== shellDictHash
    console.log(`  shell: ${shellLabel} (${shellMarkerOk ? (shellState && shellState.mode) || 'ไม่ทราบโหมด' : 'ไม่มีการแทรก'})` +
      (shellDrift ? c.warn(' · พจนานุกรมใหม่กว่า → ควรสั่ง install') : ''))
  }
  console.log('\nตรวจความครบของพจนานุกรมกับแอพเวอร์ชันปัจจุบัน: node fbth/tools/check-dict.js')
  console.log('อัปเดตแอพแล้วมีคำใหม่: node fbth/tools/extract-strings.js --jsx --auto --json fbth/dict/candidates-jsx.json && node fbth/tools/dict-tools.js todo --write')
  return 0
}

// ── shell (Electron main process): เมนู native / dialog ───────────────────────
/** พจนานุกรมสำหรับ shell = พจนานุกรม UI + คำของเมนู/dialog */
function loadShellDict() {
  const base = loadDictionaries()
  const shellOnly = readJsonSafe(SHELL_DICT_SRC, null)
  if (!shellOnly) return base
  Object.assign(base.strings, shellOnly.strings || {})
  Object.assign(base.phrases, shellOnly.phrases || {})
  const seen = new Set(base.patterns.map((p) => String(p.from)))
  for (const p of shellOnly.patterns || []) {
    if (seen.has(String(p.from))) continue
    seen.add(String(p.from))
    base.patterns.push(p)
  }
  base.meta.counts = {
    strings: Object.keys(base.strings).length,
    phrases: Object.keys(base.phrases).length,
    patterns: base.patterns.length,
  }
  base.meta.shell = true
  return base
}

/** ตรวจ syntax ของ JS ก่อนเขียนลงแอพ (กันแอพเปิดไม่ขึ้น) */
function validateJs(source, label) {
  // new vm.Script = compile เท่านั้น ไม่รันโค้ด
  new (require('node:vm').Script)(source, { filename: label })
}

function shellDirOf(root) {
  return path.join(root, 'resources', APP_FBTH_DIR)
}

/**
 * ตรวจว่า main.cjs ถูกแทรกแล้วหรือยัง
 * ลำดับความสำคัญ: app.asar เป็นไฟล์ที่ Electron โหลดจริง (ทดสอบบนเครื่องนี้แล้วว่า
 * asar ชนะโฟลเดอร์ resources/app) — ถ้าไม่มี asar จึงดูที่โฟลเดอร์ app
 */
function shellPatched(root) {
  const asarPath = asarPathOf(root)
  try {
    if (fs.existsSync(asarPath)) {
      const { openAsar } = require('./lib/asar.js')
      const asar = openAsar(asarPath)
      try {
        const buf = asar.readFile('electron/main.cjs')
        return !!buf && buf.toString('utf8').includes(SHELL_MARKER)
      } finally {
        asar.close()
      }
    }
    const extracted = extractedMainPathOf(root)
    if (fs.existsSync(extracted)) return fs.readFileSync(extracted, 'utf8').includes(SHELL_MARKER)
    return false
  } catch (e) {
    return false
  }
}

function asarPathOf(root) {
  return path.join(root, 'resources', 'app.asar')
}

function extractedMainPathOf(root) {
  return path.join(root, 'resources', 'app', 'electron', 'main.cjs')
}

/** คัดลอกไฟล์ของ fbth ที่ shell ต้องใช้เข้าไปในแอพ */
function writeShellAssets(root, shellDict, opts) {
  const dir = shellDirOf(root)
  // --dry-run ต้องไม่เขียน/สร้างอะไรเลย (แม้แต่โฟลเดอร์เปล่า)
  if (!opts.dryRun) fs.mkdirSync(dir, { recursive: true })
  const dictBuf = Buffer.from(JSON.stringify(shellDict))
  const runtimeBuf = fs.readFileSync(RUNTIME_SRC)
  const shellBuf = fs.readFileSync(path.join(SHELL_SRC_DIR, 'shell.cjs'))
  const writes = [
    [path.join(dir, 'shell-dict.json'), dictBuf],
    [path.join(dir, 'renderer.js'), runtimeBuf],
    [path.join(dir, 'shell.cjs'), shellBuf],
  ]
  const changed = []
  for (const [file, buf] of writes) {
    const current = fs.existsSync(file) ? fs.readFileSync(file) : null
    if (!current || !current.equals(buf)) {
      if (!opts.dryRun) fs.writeFileSync(file, buf)
      changed.push(path.basename(file))
    }
  }
  const logPath = path.join(dir, 'shell.log')
  if (!fs.existsSync(logPath) && !opts.dryRun) fs.writeFileSync(logPath, '')
  return { dir, changed, dictHash: dictContentHash(shellDict), dictCount: shellDict.meta.counts }
}

/**
 * แทรกบรรทัดโหลด shell.cjs
 *   โหมด file : clone ที่มี resources/app อยู่แล้ว → ต่อท้าย main.cjs (ไฟล์จริง)
 *   โหมด asar : ตัวติดตั้งหลัก → แทนบล็อกคอมเมนต์หัวไฟล์ด้วยโค้ดสั้น ๆ ที่ยาวเท่าเดิม
 *               (คงความยาวไบต์ → header/offset ของ asar ไม่เปลี่ยน)
 */
/** แทรกใน app.asar (โหมดที่ตัวแอพโหลดจริง) — คงความยาวไบต์ทุกกรณี */
function patchAsarMain(root, opts) {
  const asarPath = asarPathOf(root)
  if (!fs.existsSync(asarPath)) return { mode: 'asar', absent: true }
  const { openAsar } = require('./lib/asar.js')
  const asar = openAsar(asarPath)
  try {
    const rel = 'electron/main.cjs'
    const buf = asar.readFile(rel)
    if (!buf) return { mode: 'asar', error: 'ไม่พบ ' + rel + ' ใน app.asar' }
    const src = buf.toString('utf8')
    if (src.includes(SHELL_MARKER)) return { mode: 'asar', changed: false, already: true, target: asarPath }

    const end = buf.indexOf('*/')
    if (end === -1) return { mode: 'asar', error: 'ไม่พบบล็อกคอมเมนต์หัวไฟล์สำหรับใช้เป็นช่องแทรก' }
    const slotLen = end + 2
    const code = Buffer.from(SHELL_INJECT, 'utf8')
    if (slotLen < code.length + 6) return { mode: 'asar', error: 'ช่องแทรกสั้นเกินไป (' + slotLen + ' ไบต์)' }
    const padding = slotLen - code.length - 4
    const replaced = Buffer.concat([code, Buffer.from('/*' + ' '.repeat(padding) + '*/', 'utf8')])
    if (replaced.length !== slotLen) return { mode: 'asar', error: 'ความยาวไม่ตรงหลังแทรก' }
    const patched = Buffer.concat([replaced, buf.subarray(slotLen)])
    if (patched.length !== buf.length) return { mode: 'asar', error: 'ขนาดไฟล์เปลี่ยนแปลง' }

    // ตรวจ syntax ก่อนเขียน (ถ้าไฟล์เดิม compile ไม่ผ่าน เช่นมี top-level return ก็ข้ามการตรวจ)
    let validate = true
    try { validateJs(src, 'main.cjs(เดิม)') } catch (e) { validate = false }
    if (validate) {
      try { validateJs(patched.toString('utf8'), 'main.cjs(แทรกแล้ว)') }
      catch (e) { return { mode: 'asar', error: 'syntax หลังแทรกไม่ผ่าน: ' + e.message } }
    }

    if (!opts.dryRun) asar.writeSameLength(rel, patched)
    return {
      mode: 'asar', changed: true, already: false, target: asarPath, validated: validate,
      originalSlotB64: buf.subarray(0, slotLen).toString('base64'),
    }
  } finally {
    asar.close()
  }
}

/** แทรกในไฟล์ resources/app/electron/main.cjs ที่แตกไว้ (บางรุ่นของ Electron โหลดโฟลเดอร์นี้ก่อน) */
function patchExtractedMain(root, opts) {
  const extracted = extractedMainPathOf(root)
  if (!fs.existsSync(extracted)) return { mode: 'file', absent: true }
  const src = fs.readFileSync(extracted, 'utf8')
  if (src.includes(SHELL_MARKER)) return { mode: 'file', changed: false, already: true, target: extracted }
  const backup = extracted + '.fbth-original'
  const next = src + '\n' + SHELL_INJECT
  try { validateJs(next, 'main.cjs') } catch (e) { return { mode: 'file', error: 'syntax: ' + e.message } }
  if (!opts.dryRun) {
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, Buffer.from(src, 'utf8'))
    fs.writeFileSync(extracted, Buffer.from(next, 'utf8'))
  }
  return { mode: 'file', changed: true, already: false, target: extracted }
}

/** patch ทั้งสองที่ที่มี: asar (ที่โหลดจริง) + โฟลเดอร์ app ที่แตกไว้ (ให้ทนการ rebuild clone) */
function patchShellMain(root, opts) {
  const asarResult = patchAsarMain(root, opts)
  const fileResult = patchExtractedMain(root, opts)
  const errors = [asarResult.error, fileResult.error].filter(Boolean)
  if (errors.length && asarResult.error) return { mode: 'asar', error: errors.join(' / ') }
  const primary = asarResult.absent ? fileResult : asarResult
  const changed = !!asarResult.changed || !!fileResult.changed
  return {
    mode: primary.mode,
    changed,
    already: !changed && (!!asarResult.already || !!fileResult.already),
    target: primary.target || null,
    scope: [asarResult.absent ? null : 'asar', fileResult.absent ? null : 'app'].filter(Boolean).join('+'),
    validated: primary.validated !== undefined ? primary.validated : null,
    originalSlotB64: asarResult.originalSlotB64,
    errors,
  }
}

function unpatchShellMain(root, state) {
  const result = { mode: null, restored: false, reason: null, targets: [] }
  const asarPath = asarPathOf(root)
  if (fs.existsSync(asarPath) && state && state.originalSlotB64) {
    const { openAsar } = require('./lib/asar.js')
    const asar = openAsar(asarPath)
    try {
      const rel = 'electron/main.cjs'
      const buf = asar.readFile(rel)
      if (buf && buf.toString('utf8').includes(SHELL_MARKER)) {
        const originalSlot = Buffer.from(state.originalSlotB64, 'base64')
        const restored = Buffer.concat([originalSlot, buf.subarray(originalSlot.length)])
        if (restored.length === buf.length) {
          asar.writeSameLength(rel, restored)
          result.mode = 'asar'
          result.restored = true
          result.targets.push('asar')
        } else {
          result.reason = 'ความยาวไม่ตรงกับต้นฉบับ'
        }
      }
    } finally {
      asar.close()
    }
  }
  const extracted = extractedMainPathOf(root)
  if (fs.existsSync(extracted)) {
    const backup = extracted + '.fbth-original'
    const src = fs.readFileSync(extracted, 'utf8')
    if (fs.existsSync(backup)) {
      fs.copyFileSync(backup, extracted)
      fs.unlinkSync(backup)
      result.mode = 'file'
      result.restored = true
      return result
    }
    if (src.includes(SHELL_MARKER)) {
      fs.writeFileSync(extracted, Buffer.from(src.split('\n' + SHELL_INJECT).join(''), 'utf8'))
      result.mode = result.mode || 'file'
      result.restored = true
      result.targets.push('app')
    }
  }
  if (!result.restored) result.reason = result.reason || 'ไม่พบร่องรอยการแทรก'
  return result
}

// ── ติดตั้ง/ถอดส่วน shell ────────────────────────────────────────────────────
function shellStatePath(root) {
  return path.join(shellDirOf(root), 'state.json')
}

function installShellFor(opts, installs) {
  const shellDict = loadShellDict()
  let failures = 0
  log(opts.quiet, `\nพจนานุกรม shell: ${shellDict.meta.counts.strings} คำ (รวมคำของ UI) · pattern ${shellDict.meta.counts.patterns}`)
  for (const inst of installs) {
    try {
      const assets = writeShellAssets(inst.root, shellDict, opts)
      const patch = patchShellMain(inst.root, opts)
      if (patch.error) throw new Error(patch.error)

      const statePath = shellStatePath(inst.root)
      const prev = readJsonSafe(statePath, null) || {}
      const status = []
      if (assets.changed.length) status.push('ไฟล์ shell: ' + assets.changed.join(', '))
      if (patch.changed) status.push(`แทรกบรรทัดโหลด shell.cjs (${patch.scope || patch.mode})`)
      if (patch.already) status.push('แทรกไว้แล้ว')
      if (!status.length) status.push('เป็นเวอร์ชันล่าสุดอยู่แล้ว')

      log(opts.quiet, `${c.ok('✔')} ${inst.name} — เมนู native/dialog`)
      for (const s of status) log(opts.quiet, `  · ${s}`)

      if (opts.dryRun) { log(opts.quiet, c.dim('  (dry-run: ไม่ได้แก้ไฟล์)')); continue }

      fs.writeFileSync(statePath, JSON.stringify({
        patchedAt: new Date().toISOString(),
        mode: patch.mode,
        scope: patch.scope || null,
        target: patch.target || null,
        dictHash: assets.dictHash,
        dictCounts: assets.dictCount,
        validated: patch.validated !== undefined ? patch.validated : null,
        // เก็บไบต์เดิมของช่องที่เราแทน (โหมด asar) เพื่อคืนค่าได้แม่นยำ
        originalSlotB64: patch.changed && patch.mode === 'asar' ? patch.originalSlotB64 : prev.originalSlotB64,
      }, null, 2) + '\n')
    } catch (err) {
      failures++
      console.error(`${c.err('✖')} ${inst.name} (shell): ${err.message}`)
    }
  }
  return failures
}

function uninstallShellFor(opts, installs) {
  let failures = 0
  for (const inst of installs) {
    try {
      const state = readJsonSafe(shellStatePath(inst.root), null)
      if (opts.dryRun) { log(opts.quiet, `(dry-run) จะถอดส่วน shell ของ ${inst.name}`); continue }
      const r = unpatchShellMain(inst.root, state)
      const dir = shellDirOf(inst.root)
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
      log(opts.quiet, `${c.ok('✔')} ถอดเมนู/dialog ภาษาไทยแล้ว: ${inst.name}${r.reason ? ' (' + r.reason + ')' : ''}`)
    } catch (err) {
      failures++
      console.error(`${c.err('✖')} ${inst.name} (shell): ${err.message}`)
    }
  }
  return failures
}

/** เตรียมไฟล์สำหรับหน้า bench (dev/bench.html) */
function cmdBench(opts) {
  const dict = loadDictionaries()
  const devDir = path.join(PROJECT_ROOT, 'dev')
  fs.mkdirSync(devDir, { recursive: true })
  fs.writeFileSync(path.join(devDir, 'fbth-dict.json'), JSON.stringify(dict))
  fs.copyFileSync(RUNTIME_SRC, path.join(devDir, 'fbth-th.js'))
  log(opts.quiet, `เตรียม bench แล้ว: dev/fbth-dict.json (${dict.meta.counts.strings} คำ) + dev/fbth-th.js`)

  // ไฟล์เดียวจบ (runtime + พจนานุกรมฝังใน) สำหรับเปิดในเบราว์เซอร์/Preview โดยไม่ต้องมีเซิร์ฟเวอร์
  const benchHtml = path.join(devDir, 'bench.html')
  if (fs.existsSync(benchHtml)) {
    const anchor = '<script src="./fbth-th.js"></script>'
    const html = fs.readFileSync(benchHtml, 'utf8')
    if (html.includes(anchor)) {
      const inline = '<script>window.__FBTH_DICT__ = ' + JSON.stringify(dict) + ';</script>\n    <script>\n' +
        fs.readFileSync(RUNTIME_SRC, 'utf8') + '\n    </script>'
      // ใช้ฟังก์ชันแทนสตริง เพราะโค้ด runtime มี $& / $' ที่ replace ตีความเป็นรูปแบบพิเศษ
      fs.writeFileSync(path.join(devDir, 'bench-inline.html'), html.replace(anchor, () => inline), 'utf8')
      log(opts.quiet, 'เปิด dev/bench-inline.html ตรง ๆ ได้ (ไม่ต้องมีเซิร์ฟเวอร์)')
    }
  }
  log(opts.quiet, `เปิดทดสอบ: node dev/serve.js แล้วเปิด http://127.0.0.1:8791/`)
  return 0
}

function cmdEnsure(opts) {
  const dict = loadDictionaries()
  const shellDictHash = dictContentHash(loadShellDict())
  const dictHash = dictContentHash(dict)
  const runtimeHash = sha1(fs.readFileSync(RUNTIME_SRC))
  let need = false
  // ต้องเคารพ --app/--main/--clones เหมือนคำสั่งอื่น ไม่งั้น --app <โฟลเดอร์หนึ่ง>
  // จะไปตรวจที่ติดตั้งอื่น แล้วคืน 0 ทั้งที่โฟลเดอร์เป้าหมายยังไม่ได้แปล
  const installs = selectInstalls(opts)
  if (!installs.length) {
    console.error(c.err('ไม่พบที่ติดตั้ง Freebuff'))
    return 1
  }
  for (const inst of installs) {
    const uiDir = uiDirOf(inst.root)
    const indexPath = path.join(uiDir, 'index.html')
    const html = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : ''
    if (!html.includes(MARKER)) { need = true; break }
    const runtimeOk = fs.existsSync(path.join(uiDir, 'fbth-th.js')) &&
      sha1(fs.readFileSync(path.join(uiDir, 'fbth-th.js'))) === runtimeHash
    const dictOk = storedDictHash(uiDir) === dictHash
    if (!runtimeOk || !dictOk) { need = true; break }
    // ส่วน shell
    if (!shellPatched(inst.root)) { need = true; break }
    const shellState = readJsonSafe(shellStatePath(inst.root), null)
    if (!shellState || shellState.dictHash !== shellDictHash) { need = true; break }
  }
  if (!need) {
    log(opts.quiet, c.ok('✔') + ' ภาษาไทยพร้อมใช้งานแล้ว')
    return 0
  }
  log(opts.quiet, 'พบการติดตั้งที่ยังไม่ได้แปล หรือพจนานุกรมใหม่กว่า — กำลังติดตั้งให้...')
  return cmdInstall(opts)
}

/** เปิดแอพ Freebuff (หลังซ่อมการแปลให้เรียบร้อย) — ใช้โดยตัวเรียกแอพของชุดภาษาไทย */
function cmdLaunch(opts) {
  const code = cmdEnsure(opts)
  if (code) log(opts.quiet, c.warn('! ติดตั้งการแปลไม่เรียบร้อย จะเปิดแอพต่อตามเดิม'))
  const installs = selectInstalls(opts)
  const target = installs.find((i) => i.kind === 'main') || installs[0]
  if (!target) {
    console.error('ไม่พบที่ติดตั้ง Freebuff — ระบุเองด้วย --app <โฟลเดอร์แอพ>')
    return 1
  }
  const exe = path.join(target.root, 'Freebuff.exe')
  if (!fs.existsSync(exe)) {
    console.error(`ไม่พบ ${exe}`)
    return 1
  }
  try {
    const child = require('node:child_process').spawn(exe, [], {
      cwd: target.root,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    child.unref()
    log(opts.quiet, c.ok('✔') + ` เปิดแอพแล้ว: ${exe}`)
    return 0
  } catch (e) {
    console.error('เปิดแอพไม่สำเร็จ: ' + (e && e.message ? e.message : e))
    return 1
  }
}

/** แสดงที่ติดตั้งที่ตรวจพบ (ไว้ช่วยเหลือเมื่อติดตั้งไม่ถูกที่) */
function cmdWhere(opts) {
  const installs = findInstalls()
  if (!installs.length) {
    console.log('ไม่พบที่ติดตั้ง Freebuff ในเครื่องนี้')
    console.log('ถ้าติดตั้งไว้ที่อื่น ให้ใช้: --app <โฟลเดอร์ที่มี Freebuff.exe>')
    return 1
  }
  for (const inst of installs) {
    const ui = uiDirOf(inst.root)
    const patched = fs.existsSync(path.join(ui, 'index.html')) && fs.readFileSync(path.join(ui, 'index.html'), 'utf8').includes(MARKER)
    console.log(`${patched ? c.ok('ติดตั้งแล้ว ') : c.dim('ยังไม่ติดตั้ง')} ${inst.kind === 'main' ? 'ตัวหลัก' : 'สำเนา'}  ${inst.root}`)
  }
  return 0
}

function parseArgs(argv) {
  const opts = { dryRun: false, quiet: false, main: false, clones: false, app: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run' || a === '-n') opts.dryRun = true
    else if (a === '--quiet' || a === '-q') opts.quiet = true
    else if (a === '--all') { opts.main = false; opts.clones = false }
    else if (a === '--main') opts.main = true
    else if (a === '--clones') opts.clones = true
    else if (a === '--app') opts.app = argv[++i]
    else if (a === '--no-shell') opts.shell = false
    else if (a === '--renderer-only') opts.rendererOnly = true
    else if (a === '--shell-only') opts.shellOnly = true
  }
  return opts
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const opts = parseArgs(rest)
  switch (cmd) {
    case 'install': return cmdInstall(opts)
    case 'uninstall': case 'remove': return cmdUninstall(opts)
    case 'status': return cmdStatus(opts)
    case 'ensure': return cmdEnsure(opts)
    case 'launch': return cmdLaunch(opts)
    case 'where': return cmdWhere(opts)
    case 'install-shell': { const n = installShellFor(opts, selectInstalls(opts)); return n ? 1 : 0 }
    case 'uninstall-shell': { const n = uninstallShellFor(opts, selectInstalls(opts)); return n ? 1 : 0 }
    case 'shell-log': {
      for (const inst of selectInstalls(opts)) {
        const p = path.join(shellDirOf(inst.root), 'shell.log')
        console.log(`\n== ${inst.name} — ${p}`)
        if (!fs.existsSync(p)) { console.log('(ยังไม่มี log)'); continue }
        const lines = fs.readFileSync(p, 'utf8').trim().split('\n')
        console.log(lines.slice(-40).join('\n'))
      }
      return 0
    }
    case 'bench': return cmdBench(opts)
    case 'help': case undefined:
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, ''))
      return cmd === undefined || cmd === 'help' ? 0 : 1
  }
}

process.exit(main())
