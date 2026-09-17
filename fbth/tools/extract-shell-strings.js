#!/usr/bin/env node
/**
 * extract-shell-strings.js — ดึงข้อความที่ผู้ใช้เห็นจาก "shell" ของ Electron
 * (เมนู native, กล่องข้อความ, หน้าต่าง consent, splash)
 *
 * ใช้:
 *   node fbth/tools/extract-shell-strings.js [โฟลเดอร์ electron | ไฟล์ app.asar] [--json out.json]
 *   node fbth/tools/extract-shell-strings.js --auto
 *
 * --auto จะหาโฟลเดอร์ resources/app (ของ clone ที่แตกไว้) หรืออ่านจาก app.asar โดยตรง
 * (โหมด asar อาศัย fbth/lib/asar.js และจะอ่านแบบข้อความทั้งไฟล์)
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const KEYS = ['label', 'sublabel', 'title', 'message', 'detail', 'tooltip', 'description', 'placeholder', 'text', 'subtitle', 'buttonLabel', 'checkboxLabel', 'confirmLabel', 'cancelLabel']

function looksLikeUi(s) {
  if (typeof s !== 'string') return false
  const v = s.trim()
  if (v.length < 2 || v.length > 160) return false
  if (!/^[A-Za-z]/.test(v)) return false
  if (!/[A-Za-z]{2,}/.test(v)) return false
  if (/[\\{}<>=$|~^`]/.test(v)) return false
  if (v.includes('://')) return false
  if (/^[\w.-]+\.(js|cjs|mjs|ts|json|css|html|png|svg|txt|exe|dll)$/i.test(v)) return false
  if (/^[a-z][a-zA-Z0-9_-]*$/.test(v)) return false
  if (/^[A-Z_]{2,}$/.test(v)) return false
  return true
}

function decodeJs(raw) {
  return raw
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\'/g, "'").replace(/\\"/g, '"')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function scanSource(src, out) {
  // property: 'ข้อความ'  หรือ  property: "ข้อความ"
  const re = new RegExp('(?:' + KEYS.join('|') + ')\\s*:\\s*[\'"`]((?:[^\'"`\\\\\\n]|\\\\.){1,160})[\'"`]', 'g')
  for (const m of src.matchAll(re)) {
    const v = decodeJs(m[1])
    if (looksLikeUi(v)) out.set(v.trim(), (out.get(v.trim()) || 0) + 1)
  }
  // อาร์เรย์ปุ่ม: buttons: ['ตกลง', 'ยกเลิก']
  for (const m of src.matchAll(/buttons\s*:\s*\[([^\]]{0,400})\]/g)) {
    for (const lit of m[1].matchAll(/[\'"`]((?:[^\'"`\\\n]|\\.){1,120})[\'"`]/g)) {
      const v = decodeJs(lit[1])
      if (looksLikeUi(v)) out.set(v.trim(), (out.get(v.trim()) || 0) + 1)
    }
  }
}

function scanHtml(src, out) {
  // ข้อความระหว่างแท็ก (ตัด script/style ออก)
  const clean = src.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  for (const m of clean.matchAll(/>([^<>]{2,160})</g)) {
    const v = decodeJs(m[1]).replace(/\s+/g, ' ').trim()
    if (looksLikeUi(v)) out.set(v, (out.get(v) || 0) + 1)
  }
  for (const m of clean.matchAll(/(?:placeholder|title|aria-label)="([^"]{2,160})"/g)) {
    const v = decodeJs(m[1]).trim()
    if (looksLikeUi(v)) out.set(v, (out.get(v) || 0) + 1)
  }
}

function autoShellDirs() {
  const local = process.env.LOCALAPPDATA || ''
  const dirs = []
  const mainApp = path.join(local, 'Programs', '@codebufffreebuff-desktop', 'resources', 'app', 'electron')
  if (fs.existsSync(mainApp)) dirs.push(mainApp)
  const clonesRoot = path.join(local, 'Freebuff-Clones')
  if (fs.existsSync(clonesRoot)) {
    for (const d of fs.readdirSync(clonesRoot)) {
      const p = path.join(clonesRoot, d, 'resources', 'app', 'electron')
      if (fs.existsSync(p)) dirs.push(p)
    }
  }
  return [...new Set(dirs)]
}

/** อ่านข้อความจาก app.asar (main install ที่ยังไม่แตกโฟลเดอร์ app) */
function scanAsar(asarPath, out) {
  const { openAsar } = require('../lib/asar.js')
  const asar = openAsar(asarPath)
  const files = asar.list().filter((f) => /electron[\\/].*\.(cjs|js|html)$/.test(f))
  for (const f of files) {
    const buf = asar.readFile(f)
    if (!buf) continue
    // ปรับรหัสเพี้ยนทันทีที่อ่าน (สำเนา/clone ที่ผ่านสคริปต์ PowerShell จะเป็น UTF-8 → Latin-1)
    const fixEncoding = require('./gap-report.js').fixEncoding
    const src = fixEncoding(buf.toString('utf8'))
    if (f.endsWith('.html')) scanHtml(src, out)
    else scanSource(src, out)
  }
  asar.close()
  return files.length
}

function main() {
  const argv = process.argv.slice(2)
  const jsonIdx = argv.indexOf('--json')
  const outJson = jsonIdx !== -1 ? argv[jsonIdx + 1] : null
  const positional = argv.filter((a) => !a.startsWith('--') && a !== outJson)

  const out = new Map()
  const sources = []

  if (positional.length) {
    for (const dir of positional) {
      if (dir.endsWith('.asar')) {
        const count = scanAsar(dir, out)
        sources.push(`${dir} (${count} ไฟล์)`)
        continue
      }
      const files = fs.readdirSync(dir).filter((f) => /\.(cjs|js|html)$/.test(f))
      for (const f of files) {
        const fixEncoding = require('./gap-report.js').fixEncoding
        const src = fixEncoding(fs.readFileSync(path.join(dir, f), 'utf8'))
        sources.push(path.join(dir, f))
        if (f.endsWith('.html')) scanHtml(src, out)
        else scanSource(src, out)
      }
    }
  } else {
    const dirs = autoShellDirs()
    if (dirs.length) {
      for (const dir of dirs.slice(0, 1)) { // โครงสร้างเดียวกันทุก clone ใช้ตัวแรกพอ
        const files = fs.readdirSync(dir).filter((f) => /\.(cjs|js|html)$/.test(f))
        for (const f of files) {
          const fixEncoding = require('./gap-report.js').fixEncoding
        const src = fixEncoding(fs.readFileSync(path.join(dir, f), 'utf8'))
          sources.push(path.join(dir, f))
          if (f.endsWith('.html')) scanHtml(src, out)
          else scanSource(src, out)
        }
      }
    } else {
      const local = process.env.LOCALAPPDATA || ''
      const asar = path.join(local, 'Programs', '@codebufffreebuff-desktop', 'resources', 'app.asar')
      if (!fs.existsSync(asar)) {
        console.error('ไม่พบ shell ของ Freebuff (ทั้ง resources/app และ app.asar)')
        process.exit(1)
      }
      const count = scanAsar(asar, out)
      sources.push(`${asar} (${count} ไฟล์)`)
    }
  }

  const sorted = [...out.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  if (outJson) {
    fs.mkdirSync(path.dirname(path.resolve(outJson)), { recursive: true })
    fs.writeFileSync(outJson, JSON.stringify({
      generatedAt: new Date().toISOString(),
      sources,
      total: sorted.length,
      strings: Object.fromEntries(sorted),
    }, null, 2) + '\n', 'utf8')
    console.log(`เขียน ${sorted.length} ข้อความไปที่ ${outJson}`)
  } else {
    for (const [s] of sorted) console.log(s)
    console.log(`--- ${sorted.length} ข้อความ`)
  }
}

if (require.main === module) main()
module.exports = { looksLikeUi, scanSource, scanHtml }
