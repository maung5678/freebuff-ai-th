#!/usr/bin/env node
/**
 * selftest-pack.cjs — ทดสอบ "ชุดติดตั้งภาษาไทย" แบบครบวงจรในแซนด์บ็อกซ์
 *
 *   node dev/selftest-pack.cjs                        # ทดสอบ payload ในรีโป (fbth/)
 *   node dev/selftest-pack.cjs --payload build/Freebuff-Thai-Pack/payload/fbth
 *   node dev/selftest-pack.cjs --keep                 # เก็บแซนด์บ็อกซ์ไว้ดู
 *
 * ทำไมต้องมี: งานนี้แก้ไฟล์ในแอพจริง (index.html + app.asar) สิ่งที่ต้องพิสูจน์ให้ได้คือ
 * "ติดตั้งแล้วถอดออกได้คืนเดิมเป๊ะทุกไบต์" — ไฟล์นี้สร้างแอพปลอม (แซนด์บ็อกซ์) ที่มี
 * โครงเดียวกับแอพจริง (resources/app.asar + resources/orchestrator/ui) แล้วรัน fbth
 * กับแซนด์บ็อกซ์นั้นเท่านั้น → **ไม่แตะแอพที่ติดตั้งจริงเลย** และรันซ้ำได้ทุกครั้ง
 *
 * สิ่งที่ตรวจ
 *   1. ติดตั้ง: แทรก index.html + fbth-th.js + fbth-dict.json + ส่วน shell (asar)
 *   2. ติดตั้งซ้ำ: ต้องไม่แก้อะไรเพิ่ม (idempotent) — แฮชของไฟล์ต้องเท่าเดิม
 *   3. status/ensure: รายงานว่าติดตั้งและ "ตรงกับต้นทาง"
 *   4. make-virgin-asar: คืน slot หัวไฟล์ใน asar ได้ตรงกับต้นฉบับ (จำลองเครื่องใหม่)
 *   5. ถอดออก: index.html + app.asar + main.cjs กลับไปเท่าต้นฉบับทุกไบต์
 *   6. --dry-run: ต้องไม่เขียนไฟล์ใด ๆ
 *   7. ช่องแทรกสั้นเกินไป: ต้องล้มเหลวอย่างสุภาพ ไม่ทำ asar พัง
 *   8. (Windows) ตัวเรียก .cmd ของ pack: FBTH_APP ต้องจำกัดการติดตั้งไว้ที่โฟลเดอร์นั้น
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const argv = process.argv.slice(2)
const opt = (name, def) => {
  const i = argv.indexOf(name)
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def
}
const PAYLOAD = path.resolve(ROOT, opt('--payload', path.join('fbth')))
const PACK_DIR = opt('--pack', path.join(ROOT, 'build', 'Freebuff-Thai-Pack'))
const KEEP = argv.includes('--keep')
const SANDBOX_ROOT = path.join(ROOT, 'dev', '.selftest')

const c = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
}

let passed = 0
const failures = []

function expect(cond, label, detail) {
  if (cond) { passed++; console.log(`  ${c.ok('✔')} ${label}`); return true }
  failures.push(label)
  console.log(`  ${c.err('✖')} ${label}${detail ? c.dim(' — ' + detail) : ''}`)
  return false
}

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex')
}
const sha1File = (p) => sha1(fs.readFileSync(p))
const exists = (p) => fs.existsSync(p)

// ── แซนด์บ็อกซ์: สร้างแอพปลอมที่มีโครงเหมือนแอพจริง ───────────────────────────
const MAIN_SRC = `/**
 * sandbox main process (ไม่ใช่ไฟล์จริง — สร้างโดย dev/selftest-pack.cjs)
 * ${'ช่องว่างสำหรับทดสอบการแทรกแบบคงความยาวไบต์ '.repeat(4)}
 */
console.log('sandbox boot')
`

/** เขียน app.asar ขนาดเล็กที่ตัวอ่านของเรา (fbth/lib/asar.js) อ่านได้ */
function writeAsar(file, files) {
  const names = Object.keys(files)
  const header = { files: {} }
  let offset = 0
  const blobs = []
  for (const name of names) {
    const parts = name.split('/')
    let node = header.files
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = { files: {} }
      node = node[parts[i]].files
    }
    node[parts[parts.length - 1]] = { size: files[name].length, offset }
    offset += files[name].length
    blobs.push(files[name])
  }
  const jsonBuf = Buffer.from(JSON.stringify(header), 'utf8')
  const head = Buffer.alloc(8)
  head.writeUInt32LE(4, 0)                 // ขนาดของฟิลด์ถัดไป (ตามสเปก asar)
  head.writeUInt32LE(4 + jsonBuf.length, 4)
  // [head][ความยาว header][header][ข้อมูลไฟล์]
  fs.writeFileSync(file, Buffer.concat([head, Buffer.alloc(4), jsonBuf, ...blobs]))
}

const HTML_SRC = `<!doctype html>
<html lang="en">
  <head><title>Freebuff Desktop</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/index-TEST.js"></script>
  </body>
</html>
`

function makeSandbox(dir, { mainSrc = MAIN_SRC, withAsar = true } = {}) {
  fs.rmSync(dir, { recursive: true, force: true })
  const res = path.join(dir, 'resources')
  const ui = path.join(res, 'orchestrator', 'ui')
  fs.mkdirSync(path.join(ui, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(ui, 'index.html'), HTML_SRC, 'utf8')
  fs.writeFileSync(path.join(ui, 'assets', 'index-TEST.js'), 'console.log("ui bundle")\n', 'utf8')
  fs.mkdirSync(path.join(res, 'bun'), { recursive: true })
  if (withAsar) {
    writeAsar(path.join(res, 'app.asar'), {
      'package.json': Buffer.from('{"name":"sandbox","version":"0.0.0"}\n'),
      'electron/main.cjs': Buffer.from(mainSrc, 'utf8'),
    })
  }
  return {
    root: dir,
    ui,
    asar: path.join(res, 'app.asar'),
    shellDir: path.join(res, 'fbth'),
    indexPath: path.join(ui, 'index.html'),
    htmlSha: sha1File(path.join(ui, 'index.html')),
    asarSha: withAsar ? sha1File(path.join(res, 'app.asar')) : null,
    mainSha: withAsar ? sha1(mainBuf(path.join(res, 'app.asar'))) : null,
    asarSize: withAsar ? fs.statSync(path.join(res, 'app.asar')).size : null,
  }
}

/** อ่าน electron/main.cjs จาก asar (ใช้ตัวอ่านของ payload เอง = ทดสอบ lib ไปด้วย) */
function mainBuf(asarPath) {
  const { openAsar } = require(path.join(PAYLOAD, 'lib', 'asar.js'))
  const asar = openAsar(asarPath)
  try { return asar.readFile('electron/main.cjs') } finally { asar.close() }
}

function snapshot(sb) {
  return {
    html: sha1File(sb.indexPath),
    asar: sha1File(sb.asar),
    main: sha1(mainBuf(sb.asar)),
  }
}

// ── เรียก fbth ────────────────────────────────────────────────────────────────
function fbth(args, { env = {} } = {}) {
  const r = spawnSync(process.execPath, [path.join(PAYLOAD, 'fbth.js'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

// ── การทดสอบ ─────────────────────────────────────────────────────────────────
function scenarioRoundTrip() {
  console.log(`\n${c.dim('[1] ติดตั้ง → ซ้ำ → สถานะ → ถอด (คืนค่าเป๊ะ)')}`)
  const sb = makeSandbox(path.join(SANDBOX_ROOT, 'roundtrip'))
  const before = snapshot(sb)

  const ins = fbth(['install', '--app', sb.root])
  expect(ins.code === 0, 'install สำเร็จ (exit 0)', ins.out.split('\n').filter(Boolean).slice(-3).join(' / '))
  const html = fs.readFileSync(sb.indexPath, 'utf8')
  expect(html.includes('<script defer src="./fbth-th.js"></script>'), 'index.html มีสคริปต์ fbth-th.js')
  expect(html.includes('<!-- fbth:th -->'), 'index.html มี marker <!-- fbth:th -->')
  expect(html.includes('<title>Freebuff เดสก์ท็อป</title>'), 'title ถูกแปลเป็นไทยในไฟล์จริง')
  expect(exists(sb.indexPath + '.fbth-original'), 'มีไฟล์สำรอง index.html.fbth-original')
  expect(sha1File(sb.indexPath + '.fbth-original') === before.html, 'ไฟล์สำรอง = index.html ต้นฉบับ')
  expect(exists(path.join(sb.ui, 'fbth-th.js')) && exists(path.join(sb.ui, 'fbth-dict.json')), 'คัดลอก fbth-th.js + fbth-dict.json ลง ui/')
  const installedDict = JSON.parse(fs.readFileSync(path.join(sb.ui, 'fbth-dict.json'), 'utf8'))
  const srcDict = dictHashOfPayload()
  expect(dictContentHash(installedDict) === srcDict, 'พจนานุกรมที่ติดตั้งตรงกับต้นทาง')
  expect(Object.keys(installedDict.strings).length > 400, 'พจนานุกรมมีคำครบ (' + Object.keys(installedDict.strings).length + ' คำ)')

  // ส่วน shell (asar)
  const main = mainBuf(sb.asar).toString('utf8')
  expect(main.includes('fbth-shell-inject'), 'asar: main.cjs ถูกแทรกบรรทัดโหลด shell.cjs')
  expect(mainBuf(sb.asar).length === Buffer.from(MAIN_SRC, 'utf8').length, 'asar: ความยาว main.cjs ไม่เปลี่ยน')
  expect(sha1File(sb.asar) !== before.asar, 'asar: เนื้อหาถูกแก้ (ไม่ใช่ไฟล์เดิม)')
  expect(sha1File(sb.asar) !== before.asar && fs.statSync(sb.asar).size === sb.asarSize, 'asar: ขนาดไฟล์เท่าเดิม (แก้แบบคงความยาว)')
  for (const f of ['shell.cjs', 'shell-dict.json', 'renderer.js', 'state.json']) {
    expect(exists(path.join(sb.shellDir, f)), `ติดตั้งไฟล์ shell: ${f}`)
  }
  const shellDict = JSON.parse(fs.readFileSync(path.join(sb.shellDir, 'shell-dict.json'), 'utf8'))
  expect(Object.keys(shellDict.strings).length >= Object.keys(installedDict.strings).length, 'shell-dict รวมคำของ UI ทั้งหมด')

  // ติดตั้งซ้ำ — ต้องไม่แก้อะไรเพิ่ม
  const afterInstall = snapshot(sb)
  const ins2 = fbth(['install', '--app', sb.root])
  const afterInstall2 = snapshot(sb)
  expect(ins2.code === 0, 'install ครั้งที่ 2 สำเร็จ')
  expect(afterInstall2.html === afterInstall.html && afterInstall2.main === afterInstall.main, 'install ซ้ำไม่แก้อะไรเพิ่ม (idempotent)')
  expect(ins2.out.includes('เป็นเวอร์ชันล่าสุดอยู่แล้ว'), 'install ซ้ำรายงานว่าเป็นเวอร์ชันล่าสุด', ins2.out.split('\n').find((l) => l.includes('เวอร์ชันล่าสุด')))

  // status / ensure
  const st = fbth(['status', '--app', sb.root])
  expect(st.code === 0 && st.out.includes('ติดตั้งแล้ว'), 'status รายงานว่าติดตั้งแล้ว')
  expect(st.out.includes('ตรงกับต้นทาง'), 'status รายงานว่าไฟล์ตรงกับต้นทาง')
  expect(!st.out.includes('แอพอัปเดตแล้ว'), 'status ไม่เตือนว่าแอพอัปเดต (fingerprint ตรง)')
  const en = fbth(['ensure', '--app', sb.root])
  expect(en.out.includes('พร้อมใช้งานแล้ว'), 'ensure ไม่ติดตั้งซ้ำเมื่อพร้อมแล้ว')

  // จำลองเครื่องใหม่: คืน slot หัวไฟล์ของ asar ด้วยตัวช่วย dev/make-virgin-asar.cjs
  const virgin = spawnSync(process.execPath, [
    path.join(ROOT, 'dev', 'make-virgin-asar.cjs'),
    sb.asar,
    path.join(sb.shellDir, 'state.json'),
  ], { encoding: 'utf8' })
  expect(virgin.status === 0, 'make-virgin-asar ทำงานสำเร็จ', (virgin.stdout || '') + (virgin.stderr || ''))
  expect(sha1(mainBuf(sb.asar)) === before.main, 'make-virgin-asar คืน main.cjs ตรงกับต้นฉบับเป๊ะ')

  // ถอดออก — ต้องคืนค่าเดิมทุกไบต์
  const un = fbth(['uninstall', '--app', sb.root])
  const after = snapshot(sb)
  expect(un.code === 0, 'uninstall สำเร็จ (exit 0)', un.out.split('\n').filter(Boolean).slice(-2).join(' / '))
  expect(after.html === before.html, 'index.html กลับไปเท่าต้นฉบับเป๊ะ')
  expect(after.main === before.main, 'asar: main.cjs กลับไปเท่าต้นฉบับเป๊ะ')
  expect(after.asar === before.asar, 'asar: แฮชทั้งไฟล์กลับไปเท่าต้นฉบับเป๊ะ')
  expect(!exists(sb.indexPath + '.fbth-original') && !exists(sb.indexPath + '.fbth-state.json'), 'ไม่มีไฟล์สำรอง/state ตกค้าง')
  expect(!exists(path.join(sb.ui, 'fbth-th.js')) && !exists(path.join(sb.ui, 'fbth-dict.json')), 'ไม่มีไฟล์ fbth ตกค้างใน ui/')
  expect(!exists(sb.shellDir), 'โฟลเดอร์ resources/fbth ถูกลบทั้งโฟลเดอร์')

  // ติดตั้ง → ถอด รอบสอง ต้องได้ผลเหมือนเดิม (ไม่มี state ค้าง)
  const ins3 = fbth(['install', '--app', sb.root])
  const un3 = fbth(['uninstall', '--app', sb.root])
  const after3 = snapshot(sb)
  expect(ins3.code === 0 && un3.code === 0, 'ติดตั้ง/ถอด รอบที่สองสำเร็จ')
  expect(after3.asar === before.asar && after3.html === before.html, 'รอบที่สองก็ยังคืนค่าได้เป๊ะ')

  return { sb, before }
}

function dictContentHash(d) {
  return sha1(JSON.stringify({ strings: d.strings || {}, phrases: d.phrases || {}, patterns: d.patterns || [] }))
}
function dictHashOfPayload() {
  const dir = path.join(PAYLOAD, 'dict')
  const merged = { strings: {}, phrases: {}, patterns: [] }
  const seen = new Set()
  // ต้อง merge ด้วยลำดับเดียวกับ fbth.js (th.json เป็นฐานเสมอ) ไม่งั้นลำดับคีย์ใน JSON ต่างกัน → แฮชไม่ตรง
  const files = fs.readdirSync(dir).filter((f) => /^th[\w.-]*\.json$/.test(f) && !/^th-(removed|backup)/.test(f))
    .sort((a, b) => (a === 'th.json' ? -1 : b === 'th.json' ? 1 : a.localeCompare(b)))
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    Object.assign(merged.strings, j.strings || {})
    Object.assign(merged.phrases, j.phrases || {})
    for (const p of j.patterns || []) {
      const k = String(p.from)
      if (seen.has(k)) continue
      seen.add(k)
      merged.patterns.push(p)
    }
  }
  return dictContentHash(merged)
}

function scenarioDryRun() {
  console.log(`\n${c.dim('[2] --dry-run ต้องไม่แตะไฟล์เลย')}`)
  const sb = makeSandbox(path.join(SANDBOX_ROOT, 'dryrun'))
  const before = snapshot(sb)
  const r = fbth(['install', '--app', sb.root, '--dry-run'])
  const after = snapshot(sb)
  expect(r.code === 0, 'dry-run ออกด้วย exit 0')
  expect(r.out.includes('dry-run'), 'dry-run บอกว่าลองเท่านั้น')
  expect(after.html === before.html && after.asar === before.asar, 'dry-run: html/asar ไม่เปลี่ยน')
  expect(!exists(sb.indexPath + '.fbth-original') && !exists(sb.indexPath + '.fbth-state.json'), 'dry-run: ไม่มีไฟล์สำรอง/state ถูกสร้าง')
  expect(!exists(sb.shellDir), 'dry-run: ไม่สร้างโฟลเดอร์ resources/fbth')
}

function scenarioSmallSlot() {
  console.log(`\n${c.dim('[3] ช่องแทรกสั้นเกินไป → ต้องล้มเหลวอย่างสุภาพ')}`)
  const sb = makeSandbox(path.join(SANDBOX_ROOT, 'smallslot'), { mainSrc: '/** tiny */\nconsole.log(1)\n' })
  const before = snapshot(sb)
  const r = fbth(['install', '--app', sb.root])
  const after = snapshot(sb)
  expect(r.code !== 0, 'install ล้มเหลว (exit ไม่ใช่ 0)')
  expect(r.out.includes('ช่องแทรก'), 'แจ้งสาเหตุเรื่องช่องแทรก', r.out.split('\n').find((l) => l.includes('ช่องแทรก')))
  expect(after.asar === before.asar, 'asar ไม่ถูกแก้เลยเมื่อแทรกไม่ได้')
  expect(after.html !== before.html, 'ส่วน UI ยังติดตั้งไปแล้ว (แยกส่วนกัน ไม่พังทั้งชุด)')
}

function scenarioPackCmd() {
  if (process.platform !== 'win32') {
    console.log(`\n${c.dim('[4] ข้ามการทดสอบ .cmd (ไม่ใช่ Windows)')}`)
    return
  }
  const cmdPath = path.join(PACK_DIR, 'install-th.cmd')
  if (!exists(cmdPath)) {
    console.log(`\n${c.dim('[4] ไม่พบ ${cmdPath} — ข้าม')}`)
    return
  }
  console.log(`\n${c.dim('[4] ตัวเรียก .cmd ของ pack + FBTH_APP ต้องจำกัดที่โฟลเดอร์เดียว')}`)
  const sb = makeSandbox(path.join(SANDBOX_ROOT, 'packcmd'))
  const before = snapshot(sb)

  // แฮชของแอพจริงก่อน/หลัง เพื่อพิสูจน์ว่าไม่ถูกแตะ
  const realState = realMainStateFile()
  const realBefore = realState && exists(realState) ? sha1File(realState) : null

  const r = spawnSync('cmd.exe', ['/c', cmdPath], {
    cwd: PACK_DIR,
    encoding: 'utf8',
    input: '\n',
    env: { ...process.env, FBTH_APP: sb.root },
  })
  const out = (r.stdout || '') + (r.stderr || '')
  expect(r.status === 0, 'install-th.cmd ทำงานสำเร็จ (exit 0)', out.split('\n').filter(Boolean).slice(-3).join(' / '))
  expect(fs.readFileSync(sb.indexPath, 'utf8').includes('<!-- fbth:th -->'), 'FBTH_APP: แซนด์บ็อกซ์ถูกติดตั้ง')
  expect(snapshot(sb).asar !== before.asar, 'FBTH_APP: ส่วน shell ของแซนด์บ็อกซ์ถูกติดตั้ง')
  // ระวัง: ชื่อโฟลเดอร์โปรเจกต์เองมีคำว่า "Freebuff AI" → ห้ามเช็คแค่ 'Freebuff A'
  expect(!out.includes('Freebuff-Clones') && !out.includes('@codebufffreebuff-desktop'),
    'FBTH_APP: ไม่ไปติดตั้งที่แอพอื่นเลย', out.split('\n').filter((l) => l.includes('Freebuff-Clones') || l.includes('@codebufffreebuff-desktop')).join(' / '))
  if (realBefore) {
    expect(sha1File(realState) === realBefore, 'แอพที่ติดตั้งจริงไม่ถูกแตะเลย')
  }

  // ถอดผ่าน .cmd ของ pack เหมือนกัน — ต้องคืนค่าเป๊ะ
  const unCmd = path.join(PACK_DIR, 'uninstall-th.cmd')
  if (exists(unCmd)) {
    const r2 = spawnSync('cmd.exe', ['/c', unCmd], {
      cwd: PACK_DIR, encoding: 'utf8', input: '\n',
      env: { ...process.env, FBTH_APP: sb.root },
    })
    const after = snapshot(sb)
    expect(r2.status === 0, 'uninstall-th.cmd ทำงานสำเร็จ (exit 0)')
    expect(after.html === before.html && after.asar === before.asar, 'uninstall-th.cmd: แซนด์บ็อกซ์กลับไปเท่าต้นฉบับเป๊ะ')
    if (realBefore) expect(sha1File(realState) === realBefore, 'uninstall ที่จำกัดโฟลเดอร์ไม่แตะแอพจริง')
  }
}

/** ไฟล์ state ของแอพจริง (ตรวจว่าไม่ถูกแตะ) */
function realMainStateFile() {
  const local = process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local')
  return path.join(local, 'Programs', '@codebufffreebuff-desktop', 'resources', 'orchestrator', 'ui', 'index.html.fbth-state.json')
}

// ── เริ่ม ─────────────────────────────────────────────────────────────────────
function main() {
  console.log(`${c.dim('payload ที่ทดสอบ:')} ${PAYLOAD}`)
  if (!exists(path.join(PAYLOAD, 'fbth.js'))) {
    console.error(c.err(`ไม่พบ ${path.join(PAYLOAD, 'fbth.js')}`))
    return 1
  }
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true })
  try {
    const { sb } = scenarioRoundTrip()
    scenarioDryRun()
    scenarioSmallSlot()
    scenarioPackCmd()
    if (!KEEP) fs.rmSync(sb.root, { recursive: true, force: true })
  } finally {
    if (!KEEP) {
      for (const d of ['roundtrip', 'dryrun', 'smallslot', 'packcmd']) {
        fs.rmSync(path.join(SANDBOX_ROOT, d), { recursive: true, force: true })
      }
    }
  }

  console.log('')
  if (failures.length) {
    console.log(c.err(`ผลรวม: ผ่าน ${passed} · ไม่ผ่าน ${failures.length}`))
    for (const f of failures) console.log(c.err('  - ' + f))
    return 1
  }
  console.log(c.ok(`ผลรวม: ผ่านทั้ง ${passed} ข้อ ✔`) + c.dim(KEEP ? `  (เก็บแซนด์บ็อกซ์ไว้ที่ ${SANDBOX_ROOT})` : ''))
  return 0
}

process.exit(main())
