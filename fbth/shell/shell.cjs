/*!
 * shell.cjs — ตัวแปลภาษาไทยสำหรับ "shell" ของ Electron (main process)
 * ใช้กับเมนู native (File/View/Window/Help), กล่องข้อความ, หน้าต่าง consent
 *
 * ถูกเรียกจากโค้ดที่ fbth แทรกไว้ใน main.cjs หนึ่งบรรทัด:
 *   ;require(process.resourcesPath+'/fbth/shell.cjs');// fbth-shell-inject
 *
 * ทำอะไร
 *   1. hook Menu.buildFromTemplate / Menu.setApplicationMenu → แปล label/sublabel รวมถึง
 *      label ที่ Electron สร้างให้ role (Edit/Undo/Cut/Zoom In/Toggle Developer Tools/…)
 *   2. hook dialog.showMessageBox(Sync) / showErrorBox / showOpenDialog / showSaveDialog
 *      → แปล title/message/detail/buttonLabel/buttons
 *   3. ฉีดตัวแปล DOM (renderer.js) เข้าหน้าต่างที่ shell เปิดเอง (consent window, data: URL)
 *      และหน้าต่าง UI ของแอพ ถ้ายังไม่มีตัวแปลติดตั้งอยู่
 *
 * ไฟล์ประกอบ (โฟลเดอร์เดียวกับไฟล์นี้)
 *   shell-dict.json  พจนานุกรม (merge จากโปรเจกต์: dict/*.json + dict/shell-th.json)
 *   renderer.js      ตัวแปล DOM ฝั่งหน้าเว็บ (สำเนาของ runtime/fbth-th.js)
 *   shell.log        บันทึกการทำงาน (ไว้ตรวจสอบ/handoff)
 *
 * ตรวจสอบ/รีโหลดตอนแอพเปิดอยู่: ต้องเปิด DevTools ของ main process หรือดู shell.log
 * ในแอพ: เปิดหน้าต่างผู้ใช้ (F12) แล้วเรียก fbth.stats() สำหรับฝั่งหน้าเว็บเท่านั้น
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DIR = __dirname
const LOG_PATH = path.join(DIR, 'shell.log')
const DICT_PATH = path.join(DIR, 'shell-dict.json')
const RENDERER_PATH = path.join(DIR, 'renderer.js')
const MARKER = 'fbth-shell-inject'
const MAX_LOG_BYTES = 512 * 1024

function log(line) {
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > MAX_LOG_BYTES) fs.truncateSync(LOG_PATH, 0)
    fs.appendFileSync(LOG_PATH, new Date().toISOString() + ' ' + line + '\n')
  } catch (e) { /* ห้ามให้ log ทำให้แอพพัง */ }
}

// ── พจนานุกรม + ตัวจับคู่ (semantics เดียวกับ runtime/fbth-th.js) ──────────────
let dict = { strings: {}, phrases: {}, patterns: [] }
let stringMap = Object.create(null)
let patternList = []
const stats = { menuItems: 0, dialogFields: 0, injectedWindows: 0, misses: [] }

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function compilePattern(entry) {
  if (!entry || typeof entry.from !== 'string' || typeof entry.to !== 'string') return null
  const names = []
  const body = escapeRe(entry.from).replace(/\\\{([a-zA-Z0-9_]+)(?::([^}]*))?\\\}/g, (_, name, kind) => {
    names.push(name)
    if (kind === 'num') return '(\\d[\\d.,]*)'
    if (kind === 'word') return '([^\\s]+)'
    return '([\\s\\S]+?)'
  })
  let re
  try { re = new RegExp('^' + body + '$') } catch (e) { return null }
  return {
    re,
    build(m) {
      let out = entry.to
      for (let i = 0; i < names.length; i++) {
        out = out.split('{' + names[i] + '}').join(m[i + 1])
        out = out.split('{' + names[i] + ':num}').join(m[i + 1])
      }
      return out
    },
  }
}

function rebuildIndex() {
  stringMap = Object.create(null)
  for (const [k, v] of Object.entries(dict.strings || {})) stringMap[k] = v
  patternList = (dict.patterns || []).map(compilePattern).filter(Boolean)
}

function loadDict() {
  try {
    dict = JSON.parse(fs.readFileSync(DICT_PATH, 'utf8'))
    rebuildIndex()
    log(`dict loaded: ${Object.keys(dict.strings || {}).length} strings, ${patternList.length} patterns`)
    return true
  } catch (e) {
    log('dict load failed: ' + e.message)
    return false
  }
}

/**
 * แก้ข้อความที่ถูกรหัสเพี้ยน (mojibake) ก่อนเทียบพจนานุกรม
 * สาเหตุ: สคริปต์ PowerShell ที่ใช้ทำสำเนาแอพ (clone) อ่าน/เขียนไฟล์เป็น UTF-8 → Latin-1
 * ทำให้ `…` กลายเป็น `â€¦` และ `’` กลายเป็น `â€™` เป็นต้น
 */
const MOJIBAKE = [
  ['\u00e2\u20ac\u00a6', '\u2026'],
  ['\u00e2\u20ac\u2122', '\u2019'],
  ['\u00e2\u20ac\u0153', '\u201c'],
  ['\u00e2\u20ac\u009d', '\u201d'],
  ['\u00e2\u20ac\u201c', '\u2013'],
  ['\u00e2\u20ac\u201d', '\u2014'],
  ['\u00c2\u00b7', '\u00b7'],
  ['\u00c2\u00a0', ' '],
]

function fixEncoding(text) {
  let out = text
  for (const [bad, good] of MOJIBAKE) {
    if (out.indexOf(bad) !== -1) out = out.split(bad).join(good)
  }
  return out
}

/** แปลข้อความหนึ่งค่า (คืนค่าเดิมถ้าไม่พบในพจนานุกรม) */
function tr(value) {
  if (typeof value !== 'string') return value
  const raw = value.trim()
  if (!raw) return value
  const core = fixEncoding(raw)
  const hit = stringMap[core]
  if (hit !== undefined) return value.replace(raw, hit)
  for (const p of patternList) {
    const m = p.re.exec(core)
    if (m) return value.replace(raw, p.build(m))
  }
  return value
}

loadDict()

// ── 1) เมนู native ───────────────────────────────────────────────────────────
function translateItems(items) {
  if (!Array.isArray(items)) return items
  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const next = { ...item }
    if (typeof next.label === 'string') next.label = tr(next.label)
    if (typeof next.sublabel === 'string') next.sublabel = tr(next.sublabel)
    if (Array.isArray(next.submenu)) next.submenu = translateItems(next.submenu)
    return next
  })
}

/** แปล label ของ MenuItem ที่สร้างเสร็จแล้ว (สำคัญกับ role ที่ Electron ตั้งชื่ออังกฤษให้เอง) */
function translateMenuInstance(menu, seen) {
  seen = seen || new Set()
  if (!menu || typeof menu !== 'object' || seen.has(menu)) return
  seen.add(menu)
  const items = menu.items
  if (!Array.isArray(items)) return
  for (const item of items) {
    try {
      if (typeof item.label === 'string' && item.label) {
        const next = tr(item.label)
        if (next !== item.label) {
          item.label = next
          stats.menuItems++
        }
      }
      if (typeof item.sublabel === 'string' && item.sublabel) item.sublabel = tr(item.sublabel)
      if (item.submenu) translateMenuInstance(item.submenu, seen)
    } catch (e) { /* MenuItem บางตัวอ่าน label ไม่ได้ */ }
  }
}

function installMenuHooks(electron) {
  const { Menu } = electron
  const origBuild = Menu.buildFromTemplate
  const origSet = Menu.setApplicationMenu

  Menu.buildFromTemplate = function (template) {
    const menu = origBuild.call(this, translateItems(template))
    translateMenuInstance(menu)
    return menu
  }

  Menu.setApplicationMenu = function (menu) {
    translateMenuInstance(menu)
    return origSet.call(this, menu)
  }

  // เมนูที่ตั้งไว้ก่อนเราถูกโหลด (เช่น ตอนแทรกท้ายไฟล์ของ clone) → แปล + ตั้งใหม่
  try {
    const current = Menu.getApplicationMenu()
    if (current) {
      translateMenuInstance(current)
      origSet.call(Menu, current)
      log('app menu re-applied after late load')
    }
  } catch (e) { log('menu re-apply failed: ' + e.message) }
}

// ── 2) dialog ────────────────────────────────────────────────────────────────
function trDialogOptions(opts) {
  if (!opts || typeof opts !== 'object') return opts
  const next = { ...opts }
  for (const key of ['title', 'message', 'detail', 'buttonLabel', 'checkboxLabel']) {
    if (typeof next[key] === 'string') next[key] = tr(next[key])
  }
  if (Array.isArray(next.buttons)) next.buttons = next.buttons.map((b) => tr(b))
  // ชื่อชนิดไฟล์ที่โชว์ในกล่องเลือกไฟล์ เช่น "Markdown files"
  if (Array.isArray(next.filters)) {
    next.filters = next.filters.map((f) =>
      f && typeof f === 'object' && typeof f.name === 'string' ? { ...f, name: tr(f.name) } : f
    )
  }
  if (typeof next.defaultPath === 'string') { /* path ไม่แปล */ }
  return next
}

function isWindowish(x) { return x && typeof x === 'object' && typeof x.isDestroyed === 'function' }

function installDialogHooks(electron) {
  const { dialog } = electron
  const wrapAsync = (name) => {
    const orig = dialog[name]
    if (typeof orig !== 'function') return
    dialog[name] = function (a, b) {
      if (isWindowish(a)) return orig.call(this, a, trDialogOptions(b))
      return orig.call(this, trDialogOptions(a))
    }
  }
  const wrapSync = (name) => {
    const orig = dialog[name]
    if (typeof orig !== 'function') return
    dialog[name] = function (a, b) {
      if (isWindowish(a)) return orig.call(this, a, trDialogOptions(b))
      return orig.call(this, trDialogOptions(a))
    }
  }
  for (const name of ['showMessageBox', 'showOpenDialog', 'showSaveDialog']) wrapAsync(name)
  for (const name of ['showMessageBoxSync', 'showOpenDialogSync', 'showSaveDialogSync']) wrapSync(name)

  const origError = dialog.showErrorBox
  if (typeof origError === 'function') {
    dialog.showErrorBox = function (title, content) { return origError.call(this, tr(title), tr(content)) }
  }
}

// ── 3) ฉีดตัวแปล DOM เข้าหน้าต่างของ shell ────────────────────────────────────
let rendererCode = null

function loadRendererCode() {
  if (rendererCode !== null) return rendererCode
  try {
    rendererCode = fs.readFileSync(RENDERER_PATH, 'utf8')
  } catch (e) {
    rendererCode = ''
  }
  return rendererCode
}

function injectionPayload() {
  const code = loadRendererCode()
  if (!code) return null
  return 'window.__FBTH_DICT__=' + JSON.stringify(dict) + ';\n' + code
}

function installWindowHook(electron) {
  const { app } = electron
  app.on('web-contents-created', (_event, contents) => {
    try {
      contents.on('console-message', (_event2, _level, message) => {
        try {
          const marker = '__FBTH_USAGE__'
          if (typeof message !== 'string' || !message.startsWith(marker)) return
          const value = JSON.parse(message.slice(marker.length))
          const target = path.join(app.getPath('userData'), 'freebuff-manager-usage.json')
          fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', 'utf8')
        } catch (e) { log('usage snapshot failed: ' + e.message) }
      })
      contents.on('dom-ready', () => {
        try {
          if (contents.isDestroyed()) return
          const url = contents.getURL() || ''
          // ข้าม devtools และหน้าเล่นของ DevTools
          const type = typeof contents.getType === 'function' ? contents.getType() : 'window'
          if (type === 'devtools') return
          const payload = injectionPayload()
          if (!payload) return
          contents.executeJavaScript(payload, true).then(() => { stats.injectedWindows++ }).catch(() => {})
          if (!/^https?:/.test(url)) log('injected DOM translator into ' + url.slice(0, 60))
        } catch (e) { /* ห้ามทำให้หน้าต่างพัง */ }
      })
    } catch (e) { /* ignore */ }
  })
}

/** เขียนสรุปเมนูที่แปลแล้วลง shell.log (ไว้ตรวจสอบว่าเมนูเป็นไทยจริง) */
let lastMenuSignature = null

function dumpApplicationMenu() {
  try {
    const menu = require('electron').Menu.getApplicationMenu()
    if (!menu) { log('menu dump: no application menu yet'); return }
    const lines = []
    const walk = (items, depth) => {
      for (const item of items || []) {
        if (item.type === 'separator') continue
        // item ที่ visible:false เป็นรายการซ่อนไว้ผูกคีย์ลัด (แอพนี้ใช้กับ Zoom) — ทำเครื่องหมายไว้ไม่ให้เข้าใจผิด
        const hidden = item.visible === false ? ' [ซ่อน]' : ''
        lines.push('  '.repeat(depth) + (item.label || '(role: ' + item.role + ')') + hidden)
        if (item.submenu) walk(item.submenu.items, depth + 1)
      }
    }
    walk(menu.items, 0)
    const text = lines.join('\n')
    // แอพตั้งเมนูของตัวเองหลังหน้าต่างโหลด จึงดึงซ้ำหลายรอบ — จดเฉพาะตอนที่เมนูเปลี่ยน
    if (text === lastMenuSignature) return
    lastMenuSignature = text
    log('menu dump:\n' + text)
  } catch (e) { log('menu dump failed: ' + e.message) }
}

// ── เริ่มทำงาน ───────────────────────────────────────────────────────────────
try {
  const electron = require('electron')
  installMenuHooks(electron)
  installDialogHooks(electron)
  installWindowHook(electron)
  log('shell hooks installed (menu/dialog/window)')
  // เมนูของแอพมักถูกตั้งหลังโหลดไฟล์นี้ → ดึงสถานะล่าสุดอีกครั้งเมื่อแอพพร้อม
  try {
    electron.app.whenReady().then(() => {
      for (const delay of [1500, 4000, 9000, 20000]) setTimeout(dumpApplicationMenu, delay)
    })
  } catch (e) { log('whenReady hook failed: ' + e.message) }
} catch (e) {
  log('shell hook install failed: ' + (e && e.stack ? e.stack : e))
}

// API สำหรับ debug: เปิด DevTools ของ main process แล้วเรียก __fbthShell.stats()
global.__fbthShell = {
  marker: MARKER,
  translate: tr,
  fixEncoding,
  reloadDict: () => { loadDict() },
  stats: () => ({
    dictStrings: Object.keys(dict.strings || {}).length,
    patterns: patternList.length,
    menuItemsTranslated: stats.menuItems,
    dialogsTranslated: stats.dialogFields,
    windowsInjected: stats.injectedWindows,
  }),
  logPath: LOG_PATH,
}
