#!/usr/bin/env node
/**
 * build-pack.js — ประกอบ "ชุดภาษาไทย (Thai Pack)" สำหรับส่งให้เพื่อน/เครื่องอื่น
 *
 *   node fbth/tools/build-pack.js [--out build] [--no-zip]
 *
 * ได้ผลลัพธ์:
 *   build/Freebuff-Thai-Pack/
 *     ติดตั้งภาษาไทย.cmd        ← ดับเบิลคลิกเพื่อติดตั้งบนเครื่องนั้น
 *     ถอดภาษาไทย.cmd
 *     ตรวจภาษาไทย.cmd
 *     เปิด Freebuff ไทย.cmd     ← ตัวเปิดแอพ (ติดตั้งซ่อมให้เองทุกครั้งก่อนเปิด)
 *     payload/                  ← ตัวเครื่องมือ (fbth) + พจนานุกรม + runtime
 *     README-ไทย.md
 *     วิธีใช้.txt
 *   build/Freebuff-Thai-Pack.zip (ถ้าไม่ใส่ --no-zip)
 *
 * ตัวติดตั้งไม่ต้องใช้ Node ที่เครื่องปลายทาง: หยิบ bun.exe ที่แอพมีอยู่แล้ว → node → Electron (ELECTRON_RUN_AS_NODE)
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')      // Freebuff AI TH/
const SRC = path.join(ROOT, 'fbth')
const VERSION = '5'

const argv = process.argv.slice(2)
const outIdx = argv.indexOf('--out')
const OUT = path.resolve(ROOT, outIdx !== -1 ? argv[outIdx + 1] : 'build')
const NO_ZIP = argv.includes('--no-zip')

const PACK = path.join(OUT, 'Freebuff-Thai-Pack')
const PAYLOAD = path.join(PACK, 'payload')

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }) }
function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name)
    const dst = path.join(to, e.name)
    if (!filter(e.name, src)) continue
    if (e.isDirectory()) copyDir(src, dst, filter)
    else fs.copyFileSync(src, dst)
  }
}

// ไฟล์งานภายใน (ไม่ต้องส่งไปให้เพื่อน)
const SKIP_FILES = /^(candidates.*\.json|gap-.*\.json|.*\.bak|TODO\.md)$/

function build() {
  rmrf(PACK)
  fs.mkdirSync(PACK, { recursive: true })

  // ── payload: ตัวเครื่องมือทั้งชุด ────────────────────────────────────────
  copyDir(path.join(SRC, 'dict'), path.join(PAYLOAD, 'fbth', 'dict'), (name) => !SKIP_FILES.test(name))
  copyDir(path.join(SRC, 'runtime'), path.join(PAYLOAD, 'fbth', 'runtime'))
  copyDir(path.join(SRC, 'shell'), path.join(PAYLOAD, 'fbth', 'shell'))
  copyDir(path.join(SRC, 'lib'), path.join(PAYLOAD, 'fbth', 'lib'))
  copyDir(path.join(SRC, 'tools'), path.join(PAYLOAD, 'fbth', 'tools'))
  fs.copyFileSync(path.join(SRC, 'fbth.js'), path.join(PAYLOAD, 'fbth', 'fbth.js'))
  fs.writeFileSync(path.join(PAYLOAD, 'version.txt'), `thai-pack ${VERSION}\nbuilt ${new Date().toISOString()}\n`, 'utf8')

  writeRunScript()
  writeCmd('ติดตั้งภาษาไทย.cmd', 'install', 'ติดตั้งภาษาไทยให้แอพ Freebuff ทุกตัวที่พบในเครื่องนี้')
  writeCmd('ถอดภาษาไทย.cmd', 'uninstall', 'ถอดภาษาไทยออก คืนแอพเป็นภาษาอังกฤษ (ใช้ไฟล์สำรองที่เก็บไว้)')
  writeCmd('ตรวจภาษาไทย.cmd', 'status', 'ตรวจว่าติดตั้งภาษาไทยอยู่หรือไม่ และพจนานุกรมเป็นรุ่นล่าสุดไหม')
  writeCmd('เปิด Freebuff ไทย.cmd', 'launch', 'เปิดแอพ Freebuff (ซ่อมการแปลให้อัตโนมัติถ้าแอพเพิ่งอัปเดต)', { pause: false })
  // ชื่อไฟล์แบบ ASCII — สะดวกกับเครื่องมือ/สคริปต์ที่จัดการชื่อภาษาไทยไม่เก่ง
  writeCmd('install-th.cmd', 'install', 'ติดตั้งภาษาไทยให้แอพ Freebuff ทุกตัวที่พบในเครื่องนี้')
  writeCmd('uninstall-th.cmd', 'uninstall', 'ถอดภาษาไทยออก คืนแอพเป็นภาษาอังกฤษ')
  writeCmd('status-th.cmd', 'status', 'ตรวจสถานะการติดตั้งภาษาไทย')
  writeCmd('launch-th.cmd', 'launch', 'ซ่อมการแปล (ถ้าจำเป็น) แล้วเปิดแอพ Freebuff', { pause: false })
  writeReadme()
  return PACK
}

const RUN_SCRIPT = `@echo off
rem ── run-fbth.cmd — เลือกตัวรัน JavaScript ที่มีในเครื่องนี้ แล้วเรียก fbth ─────────
rem ลำดับ: bun.exe ของแอพ Freebuff → node ในเครื่อง → Freebuff.exe (ELECTRON_RUN_AS_NODE)
rem ใช้: run-fbth.cmd <คำสั่งของ fbth> [ตัวเลือก...]
setlocal enabledelayedexpansion
chcp 65001 >nul
set "HERE=%~dp0"
set "FBTH=%HERE%payload\\fbth\\fbth.js"
if not exist "%FBTH%" ( echo [ผิดพลาด] ไม่พบไฟล์ %FBTH% & exit /b 1 )

rem 1) หาโฟลเดอร์แอพ: FBTH_APP → app-path.txt → ที่ติดตั้งมาตรฐาน → สำเนา (clone) ตัวแรก
rem    ถ้าผู้ใช้ระบุเอง (FBTH_APP/app-path.txt) จะถือว่า "เอาเฉพาะโฟลเดอร์นี้" → ส่ง --app ต่อให้ fbth
set "APP="
set "EXPLICIT="
if defined FBTH_APP (
  set "APP=%FBTH_APP%"
  set "EXPLICIT=1"
)
if not defined APP if exist "%HERE%app-path.txt" (
  set /p APP=<"%HERE%app-path.txt"
  set "EXPLICIT=1"
)
if not defined APP if exist "%LOCALAPPDATA%\\Programs\\@codebufffreebuff-desktop\\Freebuff.exe" set "APP=%LOCALAPPDATA%\\Programs\\@codebufffreebuff-desktop"
if not defined APP for /d %%D in ("%LOCALAPPDATA%\\Freebuff-Clones\\*") do (
  if not defined APP if exist "%%~fD\\Freebuff.exe" set "APP=%%~fD"
)
if defined APP if "!APP:~-1!"=="\\" set "APP=!APP:~0,-1!"

rem ตัวเลือก --app (เฉพาะเมื่อผู้ใช้ระบุเอง) — ต้องต่อท้าย %* เพราะ "คำสั่ง" ต้องเป็นอาร์กิวเมนต์แรกของ fbth
set "APPARG="
if defined EXPLICIT if defined APP set APPARG=--app "%APP%"

rem 2) bun ของแอพ (เร็วและไม่มี dependency) — ใช้ได้กับสคริปต์ Node ทั่วไป
if defined APP if exist "%APP%\\resources\\bun\\bun.exe" (
  "%APP%\\resources\\bun\\bun.exe" "%FBTH%" %* %APPARG%
  exit /b %errorlevel%
)
if exist "%LOCALAPPDATA%\\Programs\\@codebufffreebuff-desktop\\resources\\bun\\bun.exe" (
  "%LOCALAPPDATA%\\Programs\\@codebufffreebuff-desktop\\resources\\bun\\bun.exe" "%FBTH%" %* %APPARG%
  exit /b %errorlevel%
)

rem 3) node ที่ติดตั้งในเครื่อง
where node >nul 2>nul
if %errorlevel%==0 (
  node "%FBTH%" %* %APPARG%
  exit /b %errorlevel%
)

rem 4) ใช้ Electron ของแอพเป็น Node
if defined APP if exist "%APP%\\Freebuff.exe" (
  set "ELECTRON_RUN_AS_NODE=1"
  "%APP%\\Freebuff.exe" "%FBTH%" %* %APPARG%
  exit /b %errorlevel%
)

echo.
echo [ผิดพลาด] หาตัวรัน JavaScript ไม่เจอเลย (ไม่มี bun, node หรือ Freebuff)
echo   วิธีแก้: ติดตั้ง Node.js จาก https://nodejs.org แล้วรันไฟล์นี้ใหม่
echo   หรือระบุโฟลเดอร์แอพเอง:  set FBTH_APP=C:\\path\\to\\Freebuff   แล้วรันใหม่
exit /b 1
`

function writeRunScript() {
  fs.writeFileSync(path.join(PACK, 'run-fbth.cmd'), RUN_SCRIPT.replace(/\n/g, '\r\n'), 'utf8')
}

function writeCmd(fileName, action, description, { pause = true } = {}) {
  const body = `@echo off
chcp 65001 >nul
title Freebuff ภาษาไทย
echo ────────────────────────────────────────────────
echo  ${description}
echo ────────────────────────────────────────────────
echo.
"%~dp0run-fbth.cmd" ${action} %*
set "RC=%errorlevel%"
echo.
if not "%RC%"=="0" ( echo มีบางอย่างไม่สำเร็จ ^(รหัส %RC%^) )
${pause ? 'pause\n' : ''}exit /b %RC%
`
  fs.writeFileSync(path.join(PACK, fileName), body.replace(/\n/g, '\r\n'), 'utf8')
}

function writeReadme() {
  // ต้องนับหลังคัดลอก payload แล้ว จึงเรียกในฟังก์ชันนี้
  const COUNTS = dictCounts()
  const md = `# Freebuff ภาษาไทย — ชุดติดตั้งสำหรับเครื่องอื่น (Thai Pack v${VERSION})

พจนานุกรม: **${COUNTS.strings} คำ** · รูปแบบข้อความอัตโนมัติ **${COUNTS.patterns}** · ประกอบเมื่อ ${new Date().toISOString().slice(0, 10)}

ชุดนี้แปล **ตัวแอพ Freebuff** (ข้อความในหน้าจอ เมนู native กล่องข้อความ) เป็นภาษาไทย
โดยไม่แก้โค้ดของแอพเลย — ใช้วิธี "พจนานุกรม + ตัวแปลขณะรัน" จึงถอดออกได้เสมอ
และติดตั้งซ้ำให้เองได้หลังแอพอัปเดต

## ชุดนี้แปลอะไรบ้าง (Thai Pack v${VERSION} · ทดสอบกับแอป v0.0.114)

* หน้าจอทั้งหมดของแอป: ปุ่ม/แท็บ/หัวข้อ/กล่องข้อความ/การแจ้งเตือน/ข้อความ error
* **คำอธิบาย (ทูลทิป)** ของสกิล ภารกิจ และระดับการคิด (reasoning effort)
* หน้าจอสลับผู้ให้บริการ–โมเดล (BYOK) พื้นที่ทำงานแบบแยก (isolated workspace) เซสชัน/โควตา/สปอนเซอร์
* ข้อความที่โปรแกรมอ่านหน้าจออ่านออกเสียง (aria-label, data-tooltip) รวมแบบที่มีชื่อ/ตัวเลขอยู่ในข้อความ
* เมนู native ของ Electron (File / Edit / View / Window / Help ที่ขึ้นตอนกด Alt) และกล่องข้อความของระบบ

## วิธีใช้ (เครื่องปลายทาง)

1. ก๊อปโฟลเดอร์นี้ทั้งโฟลเดอร์ (หรือแตกไฟล์ zip) ไว้ที่ไหนก็ได้ เช่น \`เอกสาร\\Freebuff Thai\`
2. ต้องมีแอพ **Freebuff** ติดตั้งอยู่ในเครื่องก่อน (ตัวติดตั้งจะหาที่ติดตั้งเอง)
3. ดับเบิลคลิก **\`ติดตั้งภาษาไทย.cmd\`** → จะติดตั้งให้ทุกที่ที่พบ (ตัวหลัก + สำเนา/clone)

> **ถ้าสคริปต์ไม่ทำงานเพราะไฟล์มาจากอินเทอร์เน็ต**: Windows จะใส่เครื่องหมาย "บล็อก" ให้ไฟล์ที่โหลดมา
> ให้คลิกขวาที่ไฟล์ \`.cmd\` → Properties → ติ๊ก **Unblock** → OK แล้วลองใหม่
> (หรือหากมีหน้าต่างเตือน SmartScreen: More info → Run anyway)
4. ปิดแล้วเปิดแอพ Freebuff ใหม่ (หรือกด \`Ctrl+R\` ในหน้าต่างแอพ) → เห็นภาษาไทย

ถ้าอยากให้แอพเป็นไทยตลอด (รวมหลังแอพอัปเดต) ให้เปิดแอพด้วย
**\`เปิด Freebuff ไทย.cmd\`** แทนไอคอนเดิม — มันจะตรวจและติดตั้งซ่อมให้อัตโนมัติ
(แนะนำ: คลิกขวาที่ไฟล์นี้ → ส่งไปที่ → เดสก์ท็อป (สร้างทางลัด))

## คำสั่งที่มีให้

| ไฟล์ | ทำอะไร |
| --- | --- |
| \`ติดตั้งภาษาไทย.cmd\` | ติดตั้ง/อัปเดตคำแปลลงทุกที่ที่พบ |
| \`ถอดภาษาไทย.cmd\` | ถอดออกทั้งหมด คืนแอพเป็นภาษาอังกฤษ |
| \`ตรวจภาษาไทย.cmd\` | ดูสถานะ: ติดตั้งอยู่ไหม พจนานุกรมรุ่นไหน |
| \`เปิด Freebuff ไทย.cmd\` | ซ่อม + เปิดแอพ |

## แอพติดตั้งไว้ที่อื่น (ไม่ใช่ที่มาตรฐาน)

ตัวติดตั้งหาที่ติดตั้งเองจาก \`%LOCALAPPDATA%\\Programs\\@codebufffreebuff-desktop\`
และ \`%LOCALAPPDATA%\\Freebuff-Clones\\*\` ถ้าแอพอยู่ที่อื่น ระบุได้ 2 วิธี:

\`\`\`
set FBTH_APP=D:\\Apps\\Freebuff
ติดตั้งภาษาไทย.cmd
\`\`\`

หรือสร้างไฟล์ชื่อ \`app-path.txt\` ในโฟลเดอร์นี้ ใส่ที่อยู่แอพหนึ่งบรรทัด

ทั้งสองวิธีถือว่า **เอาเฉพาะโฟลเดอร์นี้** (ไม่ไปแตะแอพอื่นในเครื่อง และเมื่อตั้งไว้จะใช้โฟลเดอร์นี้เสมอ)
ถ้าไม่ระบุอะไรเลย = ติดตั้งให้ทุกที่ที่พบ

## ไม่มี Node.js ในเครื่อง ติดตั้งได้ไหม

ได้ — ตัวติดตั้งจะใช้ \`bun.exe\` ที่แอพ Freebuff มีอยู่แล้วก่อน ถ้าไม่มีจึงลอง \`node\`
และถ้าไม่มีทั้งคู่จะใช้ \`Freebuff.exe\` ในโหมด \`ELECTRON_RUN_AS_NODE\`

## หลังแอพอัปเดตแล้วภาษาไทยหาย

แอพอัปเดตจะเขียนทับไฟล์ UI → ดับเบิลคลิก **\`ติดตั้งภาษาไทย.cmd\`** อีกครั้ง
(หรือเปิดแอพด้วย \`เปิด Freebuff ไทย.cmd\` ซึ่งเช็คให้เองทุกครั้ง)

## ความปลอดภัย / การถอดออก

* ถอดออกได้คืนเดิมเป๊ะทุกไบต์: \`index.html\` มีสำรองเป็น \`index.html.fbth-original\`
  ส่วน \`app.asar\` เก็บไบต์เดิมของช่องที่แทรกไว้ใน \`resources/fbth/state.json\`
* ไม่มีการแก้โค้ดแอพ (แก้เฉพาะ \`index.html\` กับ “ช่องคอมเมนต์” หัวไฟล์ขนาดเท่าเดิมใน \`app.asar\`)
  ไม่มีการส่งข้อมูลออกไปไหน ไม่ต้องใช้สิทธิ์ผู้ดูแลระบบ
* อยากถอด: \`ถอดภาษาไทย.cmd\`

## ทดสอบแล้ว

ชุดนี้ผ่านการทดสอบอัตโนมัติแบบแซนด์บ็อกซ์ (ติดตั้ง → ติดตั้งซ้ำ → ตรวจสถานะ → ถอดออก)
โดยยืนยันว่าไฟล์ในแอพกลับไปเท่าต้นฉบับทุกไบต์ และทดสอบแล้วกับตัวแอพจริงบนเครื่อง Windows

## รายละเอียดทางเทคนิค (สำหรับคนที่จะดูแลต่อ)

* \`payload/fbth/fbth.js\` — ตัวติดตั้ง/ถอด/สถานะ (pure Node, ไม่มี dependency)
* \`payload/fbth/runtime/fbth-th.js\` — ตัวแปล DOM ตอนรันในหน้า UI
* \`payload/fbth/shell/shell.cjs\` — hook ฝั่ง main process (เมนู native, dialog)
* \`payload/fbth/dict/*.json\` — พจนานุกรมไทย (แก้/เพิ่มได้เอง)
* เพิ่มคำใหม่: แก้ไฟล์ \`th-*.json\` แล้วรัน \`ติดตั้งภาษาไทย.cmd\` อีกครั้ง
`
  fs.writeFileSync(path.join(PACK, 'README-ไทย.md'), md, 'utf8')
  // ชื่อไฟล์แบบ ASCII (บางเครื่อง/เครื่องมืออ่านชื่อไทยไม่เก่ง)
  fs.writeFileSync(path.join(PACK, 'README-th.md'), md, 'utf8')
  const txt = `Freebuff ภาษาไทย (Thai Pack v${VERSION}) — พจนานุกรม ${COUNTS.strings} คำ

1) ต้องมีแอพ Freebuff ในเครื่องก่อน
   (ถ้าเป็นไฟล์ที่โหลดมาจากอินเทอร์เน็ต/ซิป Windows อาจบล็อกสคริปต์:
    คลิกขวาที่ไฟล์ .cmd ในโฟลเดอร์นี้ → Properties → ติ๊ก Unblock → OK
    หรือถ้ามีหน้าต่างเตือนขึ้น ให้กด More info → Run anyway)
2) ดับเบิลคลิก "ติดตั้งภาษาไทย.cmd" (หรือ install-th.cmd)
3) ปิดแล้วเปิดแอพใหม่ (หรือกด Ctrl+R)
4) อยากให้คงอยู่หลังแอพอัปเดต: เปิดแอพด้วย "เปิด Freebuff ไทย.cmd"
5) ถอดออก: "ถอดภาษาไทย.cmd"

อ่านรายละเอียดเพิ่มเติมใน README-ไทย.md
`
  fs.writeFileSync(path.join(PACK, 'วิธีใช้.txt'), txt.replace(/\n/g, '\r\n'), 'utf8')
}

/** นับคำ/รูปแบบข้อความในชุดที่เพิ่งคัดลอกลง payload (ไว้โชว์ใน README) */
function dictCounts() {
  const dir = path.join(PAYLOAD, 'fbth', 'dict')
  const keys = new Set()
  const pats = new Set()
  for (const f of fs.readdirSync(dir)) {
    if (!/\.json$/.test(f) || /^(removed|ignore)\.json$/.test(f) || /^th-(removed|backup)/.test(f)) continue
    if (f !== 'shell-th.json' && !/^th[\w.-]*\.json$/.test(f)) continue
    let j = null
    try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch (e) { continue }
    for (const k of Object.keys(j.strings || {})) keys.add(k)
    for (const p of j.patterns || []) pats.add(String(p.from))
  }
  return { strings: keys.size, patterns: pats.size }
}

function zip() {
  const zipPath = path.join(OUT, `Freebuff-Thai-Pack-v${VERSION}.zip`)
  rmrf(zipPath)
  // ใช้ตัวเขียนซิปของเราเอง (ตั้งธง UTF-8) — Compress-Archive ทำชื่อไฟล์ไทยเพี้ยน
  const { writeZip } = require(path.join(SRC, 'lib', 'zip.js'))
  const r = writeZip(PACK, zipPath)
  console.log(`  บรรจุซิป: ${r.files} ไฟล์, ${(r.zipBytes / 1024).toFixed(1)} KB (ชื่อไฟล์ UTF-8)`)
  return zipPath
}

const pack = build()
console.log(`สร้างชุดแล้ว: ${pack}`)
if (!NO_ZIP) {
  const z = zip()
  const size = (fs.statSync(z).size / 1024).toFixed(1)
  console.log(`ไฟล์สำหรับส่งต่อ: ${z} (${size} KB)`)
}
