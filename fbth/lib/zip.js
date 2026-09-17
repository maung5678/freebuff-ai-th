#!/usr/bin/env node
/**
 * zip.js — ตัวสร้างไฟล์ .zip แบบไม่พึ่ง library ภายนอก
 *
 * ทำไมต้องเขียนเอง: Compress-Archive ของ Windows PowerShell 5.1 เขียนชื่อไฟล์
 * ที่ไม่ใช่ ASCII (เช่นชื่อไทย) ด้วยรหัส ANSI ของเครื่อง โดยไม่ตั้งธง UTF-8
 * ทำให้เพื่อนที่แตกซิปเห็นชื่อเป็นตัวขยะ ("ө�ө�...") แทน "ติดตั้งภาษาไทย.cmd"
 *
 * ตัวนี้ตั้ง general purpose flag บิต 11 (UTF-8) ให้ทุก entry → แตกได้ถูกต้อง
 * ทั้งบน Windows Explorer, 7-Zip, WinRAR และ macOS/Linux
 *
 *   const { writeZip } = require('./zip')
 *   writeZip('/path/โฟลเดอร์ต้นทาง', '/path/ปลายทาง.zip')
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

// ── CRC-32 (ตามสเปก PKZIP) ─────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** เวลาแบบ MS-DOS (2 วินาที/หน่วย, ปีเริ่ม 1980) */
function dosTime(d) {
  const year = Math.max(1980, d.getFullYear())
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** เดินทุกไฟล์ใต้ srcDir → [{ rel, abs }] (เรียงตามชื่อ, คั่นด้วย /) */
function walk(srcDir, rel = '') {
  const out = []
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of entries) {
    const abs = path.join(srcDir, e.name)
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(abs, r))
    else if (e.isFile()) out.push({ rel: r, abs })
  }
  return out
}

/**
 * เขียนโฟลเดอร์ทั้งโฟลเดอร์เป็นไฟล์ zip
 * @param {string} srcDir  โฟลเดอร์ต้นทาง
 * @param {string} zipPath ไฟล์ .zip ปลายทาง
 * @param {(rel:string)=>boolean} [filter] คืน false เพื่อข้ามไฟล์
 * @returns {{files:number, bytes:number, zipBytes:number}}
 */
function writeZip(srcDir, zipPath, filter = () => true) {
  const files = walk(srcDir).filter((f) => filter(f.rel))
  const locals = []
  const centrals = []
  let offset = 0

  for (const f of files) {
    const data = fs.readFileSync(f.abs)
    const deflated = zlib.deflateRawSync(data, { level: 9 })
    const stored = deflated.length >= data.length
    const body = stored ? data : deflated
    const method = stored ? 0 : 8
    const crc = crc32(data)
    const name = Buffer.from(f.rel, 'utf8')
    const { time, date } = dosTime(fs.statSync(f.abs).mtime)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)      // ต้องมีเวอร์ชัน 2.0 ขึ้นไป
    local.writeUInt16LE(0x0800, 6)  // ธง UTF-8 (บิต 11) ← หัวใจของเรื่อง
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)      // extra field ว่าง
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4) // สร้างโดย UNIX + spec 3.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)    // extra
    central.writeUInt16LE(0, 32)    // comment
    central.writeUInt16LE(0, 34)    // disk
    central.writeUInt16LE(0, 36)    // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38) // โหมดไฟล์ -rw-r--r--
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + body.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  const out = Buffer.concat([...locals, centralBuf, eocd])
  fs.mkdirSync(path.dirname(zipPath), { recursive: true })
  fs.writeFileSync(zipPath, out)

  return { files: files.length, bytes: files.reduce((n, f) => n + fs.statSync(f.abs).size, 0), zipBytes: out.length }
}

module.exports = { writeZip, crc32, walk }

if (require.main === module) {
  const [src, dst] = process.argv.slice(2)
  if (!src || !dst) {
    console.error('ใช้: node zip.js <โฟลเดอร์ต้นทาง> <ไฟล์.zip>')
    process.exit(2)
  }
  const r = writeZip(path.resolve(src), path.resolve(dst))
  console.log(`ซิปแล้ว ${r.files} ไฟล์ → ${dst} (${(r.zipBytes / 1024).toFixed(1)} KB)`)
}
