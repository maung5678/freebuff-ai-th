#!/usr/bin/env node
/**
 * make-virgin-asar.cjs — ตัวช่วยทดสอบ: คืนค่า slot หัวไฟล์ของ app.asar ให้กลับเป็นของเดิม
 * เพื่อจำลอง "เครื่องใหม่ที่ยังไม่เคยติดตั้งภาษาไทย" แล้วทดสอบ install → uninstall ได้จริง
 *
 * ใช้: node dev/make-virgin-asar.cjs <asar ปลายทาง> <state.json ที่มี originalSlotB64>
 */
'use strict'

const fs = require('node:fs')
const crypto = require('node:crypto')
const { openAsar } = require('../fbth/lib/asar.js')

const [target, stateFile] = process.argv.slice(2)
if (!target || !stateFile) {
  console.error('ใช้: node dev/make-virgin-asar.cjs <asar> <state.json>')
  process.exit(1)
}

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
const original = Buffer.from(state.originalSlotB64, 'base64')
const before = crypto.createHash('sha1').update(fs.readFileSync(target)).digest('hex')

const asar = openAsar(target)
try {
  const buf = asar.readFile('electron/main.cjs')
  const end = buf.indexOf('*/')
  const slotLen = end + 2
  if (original.length !== slotLen) {
    console.error(`ความยาวเดิม (${original.length}) ไม่ตรงกับ slot ปัจจุบัน (${slotLen})`)
    process.exit(1)
  }
  const patched = Buffer.concat([original, buf.subarray(slotLen)])
  asar.writeSameLength('electron/main.cjs', patched)
} finally {
  asar.close()
}

const after = crypto.createHash('sha1').update(fs.readFileSync(target)).digest('hex')
console.log(`คืนค่า slot เดิมแล้ว: ${target}`)
console.log(`  sha1 ก่อน: ${before}`)
console.log(`  sha1 หลัง: ${after}`)
