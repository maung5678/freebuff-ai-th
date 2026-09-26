/**
 * asar.js — อ่าน/แก้ไฟล์ใน app.asar ของ Electron โดยไม่ต้องพึ่งไลบรารีภายนอก
 *
 * ทำไมต้องมี: shell ของแอพ (Electron main) อยู่ใน app.asar และโฟลเดอร์ resources/app.asar
 * ไม่ใช่โฟลเดอร์จริงที่แก้ไฟล์ได้ตรง ๆ เราแก้แบบ "คงความยาวไบต์" เท่านั้น
 * (fuses: EnableEmbeddedAsarIntegrityValidation = off จึงแก้ได้ และการคงความยาว
 * ทำให้ header/offset ของไฟล์อื่นไม่ต้องคำนวณใหม่ → ปลอดภัยที่สุด)
 *
 * รูปแบบไฟล์ asar
 *   [0..3]  uint32 = 4            (ขนาดของฟิลด์ถัดไป)
 *   [4..7]  uint32 = headerSize   (ขนาดของ header ที่เป็น pickled string)
 *   [8 .. 8+headerSize)  header (pickled string ของ JSON)
 *   ข้อมูลไฟล์เริ่มที่ dataStart = 8 + headerSize และ offset ใน header นับจาก dataStart
 */
'use strict'

const fs = require('node:fs')

const PICKLE_HEADER = 8

function openAsar(asarPath) {
  const fd = fs.openSync(asarPath, 'r+') // r+ เพื่อให้แก้แบบ in-place ได้
  const sizeBuf = Buffer.alloc(PICKLE_HEADER)
  fs.readSync(fd, sizeBuf, 0, PICKLE_HEADER, 0)
  const headerSize = sizeBuf.readUInt32LE(4)
  const headerBuf = Buffer.alloc(headerSize)
  fs.readSync(fd, headerBuf, 0, headerSize, PICKLE_HEADER)
  // header เป็น pickled string: [payloadSize][len][json]
  let jsonStart = 0
  const candidates = [0, 4, 8]
  let header = null
  for (const off of candidates) {
    const text = headerBuf.toString('utf8', off).replace(/\0+$/, '').trim()
    const brace = text.indexOf('{')
    if (brace === -1) continue
    try {
      header = JSON.parse(text.slice(brace))
      jsonStart = off
      break
    } catch (e) { /* ลอง offset ถัดไป */ }
  }
  if (!header) throw new Error('อ่าน header ของ asar ไม่ได้ (รูปแบบไม่รู้จัก)')
  const dataStart = PICKLE_HEADER + headerSize

  const walk = (node, prefix, acc) => {
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) walk(child, prefix ? prefix + '/' + name : name, acc)
    } else {
      acc.push({ path: prefix, size: Number(node.size) || 0, offset: Number(node.offset) || 0, unpacked: !!node.unpacked, executable: !!node.executable })
    }
    return acc
  }

  return {
    path: asarPath,
    headerSize,
    dataStart,
    header,
    headerJsonStart: jsonStart,
    fileSize: fs.statSync(asarPath).size,
    /** รายการไฟล์ทั้งหมด (path แบบใช้ / คั่น) */
    list() {
      return walk(header, '', []).map((f) => f.path)
    },
    /** รายละเอียดไฟล์ */
    stat(relPath) {
      const parts = relPath.split('/')
      let node = header
      for (const p of parts) {
        if (!node.files || !node.files[p]) return null
        node = node.files[p]
      }
      return node.files ? null : {
        path: relPath,
        size: Number(node.size) || 0,
        offset: Number(node.offset) || 0,
        unpacked: !!node.unpacked,
        absOffset: dataStart + (Number(node.offset) || 0),
      }
    },
    /** อ่านเนื้อไฟล์ (คืน null ถ้าเป็นไฟล์ unpacked ที่ไม่ได้เก็บใน archive) */
    readFile(relPath) {
      const st = this.stat(relPath)
      if (!st) return null
      if (st.unpacked) {
        const unpackedPath = asarPath + '.unpacked/' + relPath.split('/').join('/')
        return fs.existsSync(unpackedPath) ? fs.readFileSync(unpackedPath) : null
      }
      const buf = Buffer.alloc(st.size)
      fs.readSync(fd, buf, 0, st.size, st.absOffset)
      return buf
    },
    /**
     * เขียนทับเนื้อไฟล์แบบคงความยาว (ต้องยาวเท่าเดิมเท่านั้น)
     * ใช้สำหรับแทรกโค้ดโดยแทนที่ "คอมเมนต์/ช่องว่าง" ที่มีขนาดเท่ากัน
     */
    writeSameLength(relPath, buffer) {
      const st = this.stat(relPath)
      if (!st) throw new Error(`ไม่พบไฟล์ใน asar: ${relPath}`)
      if (st.unpacked) throw new Error(`ไฟล์นี้เป็นแบบ unpacked: ${relPath}`)
      if (buffer.length !== st.size) {
        throw new Error(`ขนาดไม่เท่าเดิม (เดิม ${st.size} ไบต์ ใหม่ ${buffer.length} ไบต์) — ต้องคงความยาวเท่านั้น`)
      }
      fs.writeSync(fd, buffer, 0, buffer.length, st.absOffset)
      return { written: buffer.length, absOffset: st.absOffset }
    },
    close() { fs.closeSync(fd) },
  }
}

module.exports = { openAsar }
