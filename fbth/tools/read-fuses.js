#!/usr/bin/env node
/**
 * read-fuses.js — อ่านค่า Electron "fuses" จากตัว 실행ไฟล์ (Freebuff.exe)
 *
 * ใช้:
 *   node fbth/tools/read-fuses.js [path/to/Freebuff.exe]
 *
 * ทำไมต้องรู้: fuse `EnableEmbeddedAsarIntegrityValidation` ถ้าเปิดอยู่ การแก้ app.asar
 * (แม้แต่ไบต์เดียว) จะทำให้แอพไม่ยอมสตาร์ท และ `OnlyLoadAppFromAsar` ถ้าเปิดอยู่
 * จะทำให้การวางโฟลเดอร์ resources/app ทับไม่ได้ผล
 *
 * รูปแบบข้อมูล: หา sentinel แล้วอ่าน [version:1][count:1][fuse bytes: count]
 * ค่า 0x31 ('1') = เปิด, 0x30 ('0') = ปิด, ค่าอื่น = ไม่ได้ตั้ง (ใช้ค่าเริ่มต้นของ Electron)
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX')

// ลำดับ fuse ตามเอกสาร Electron (ห้ามสลับ)
const FUSE_NAMES = [
  'RunAsNode',
  'EnableCookieEncryption',
  'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation',
  'OnlyLoadAppFromAsar',
  'LoadBrowserProcessSpecificV8Snapshot',
  'GrantFileProtocolExtraPrivileges',
]

function defaultExe() {
  const local = process.env.LOCALAPPDATA || ''
  const candidates = [
    path.join(local, 'Programs', '@codebufffreebuff-desktop', 'Freebuff.exe'),
    ...(fs.existsSync(path.join(local, 'Freebuff-Clones'))
      ? fs.readdirSync(path.join(local, 'Freebuff-Clones')).map((d) =>
          path.join(local, 'Freebuff-Clones', d, 'Freebuff.exe'))
      : []),
  ]
  return candidates.find((p) => fs.existsSync(p)) || null
}

function readFuses(exePath) {
  const buf = fs.readFileSync(exePath)
  const idx = buf.indexOf(SENTINEL)
  if (idx === -1) return { found: false, exePath, fuses: null }
  const version = buf[idx + SENTINEL.length]
  const count = buf[idx + SENTINEL.length + 1]
  const bytes = buf.subarray(idx + SENTINEL.length + 2, idx + SENTINEL.length + 2 + count)
  const fuses = {}
  for (let i = 0; i < count; i++) {
    const b = bytes[i]
    const name = FUSE_NAMES[i] || `fuse${i}`
    fuses[name] = b === 0x31 ? 'on' : b === 0x30 ? 'off' : `unset(0x${b.toString(16)})`
  }
  return { found: true, exePath, version, count, fuses }
}

function main() {
  const exe = process.argv[2] || defaultExe()
  if (!exe) {
    console.error('ไม่พบ Freebuff.exe — ระบุ path เองได้')
    process.exit(1)
  }
  const r = readFuses(exe)
  console.log(`ไฟล์: ${r.exePath}`)
  if (!r.found) {
    console.log('ไม่พบ sentinel ของ fuses (อาจเป็น Electron รุ่นที่ไม่มี fuse หรือไฟล์ไม่ถูกต้อง)')
    process.exit(2)
  }
  console.log(`fuse version: ${r.version} · จำนวน: ${r.count}`)
  for (const [k, v] of Object.entries(r.fuses)) console.log(`  ${v.padEnd(12)} ${k}`)
  const integrity = r.fuses.EnableEmbeddedAsarIntegrityValidation
  const onlyAsar = r.fuses.OnlyLoadAppFromAsar
  console.log('')
  console.log(`สรุป: แก้ app.asar ได้หรือไม่ → ${integrity === 'on' ? 'ไม่ได้ (integrity เปิดอยู่)' : 'ได้ (' + integrity + ')'}`)
  console.log(`      วางโฟลเดอร์ resources/app ทับได้หรือไม่ → ${onlyAsar === 'on' ? 'ไม่ได้' : 'ได้ (' + onlyAsar + ')'}`)
}

if (require.main === module) main()
module.exports = { readFuses, FUSE_NAMES }
