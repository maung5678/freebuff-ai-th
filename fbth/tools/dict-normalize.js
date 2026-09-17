#!/usr/bin/env node
/**
 * dict-normalize.js — กันคีย์พลาดแบบ "เกือบตรง" (อัญประกาศโค้ง ‘ ’ “ ” , ขีดยาว – —, ช่องว่างซ้ำ, NBSP)
 * เพราะตัวแปลทำงานด้วยการ "ตรงเป๊ะ" คีย์ที่พิมพ์ต่างไปหนึ่งตัวจะไม่ถูกใช้เลย
 *
 * ใช้:
 *   node fbth/tools/dict-normalize.js <dict.json> [<candidate.json> ...] [--write]
 * ถ้าไม่ระบุ candidate จะใช้ไฟล์ fbth/dict/candidates*.json ทั้งหมด
 * --write จะแก้ไฟล์พจนานุกรมให้ (สำรองเป็น .bak)
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DICT_DIR = path.join(__dirname, '..', 'dict')

function normalize(s) {
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
}

function candidateStrings(files) {
  const set = new Set()
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      for (const k of Object.keys(j.strings || {})) set.add(k)
      for (const k of Object.keys(j.patterns || {})) set.add(k)
    } catch (e) { /* ข้ามไฟล์ที่อ่านไม่ได้ */ }
  }
  return set
}

function main() {
  const argv = process.argv.slice(2)
  const write = argv.includes('--write')
  const files = argv.filter((a) => !a.startsWith('--'))
  const dictFile = files[0]
  if (!dictFile) {
    console.error('ใช้: node fbth/tools/dict-normalize.js <dict.json> [candidates*.json ...] [--write]')
    process.exit(1)
  }
  const candFiles = files.slice(1).length
    ? files.slice(1)
    : fs.readdirSync(DICT_DIR).filter((f) => /^candidates.*\.json$/.test(f)).map((f) => path.join(DICT_DIR, f))
  const cands = candidateStrings(candFiles)
  const byNorm = new Map()
  for (const c of cands) {
    const n = normalize(c)
    if (!byNorm.has(n)) byNorm.set(n, c)
  }

  const raw = fs.readFileSync(dictFile, 'utf8')
  const dict = JSON.parse(raw)
  const fixed = []
  const unresolved = []

  const fixSection = (section) => {
    const out = {}
    for (const [k, v] of Object.entries(section || {})) {
      if (cands.has(k)) { out[k] = v; continue }
      const exact = byNorm.get(normalize(k))
      if (exact && !cands.has(k)) {
        fixed.push([k, exact])
        out[exact] = v
      } else {
        unresolved.push(k)
        out[k] = v
      }
    }
    return out
  }

  const next = { ...dict, strings: fixSection(dict.strings) }
  if (Array.isArray(dict.patterns)) {
    next.patterns = dict.patterns.map((p) => {
      if (!cands.has(p.from)) {
        const exact = byNorm.get(normalize(p.from))
        if (exact) { fixed.push([p.from, exact]); return { ...p, from: exact } }
        unresolved.push(p.from)
      }
      return p
    })
  }

  console.log(`ตรวจ ${Object.keys(dict.strings || {}).length} คีย์ + ${(dict.patterns || []).length} pattern`)
  console.log(`  แก้ให้ตรงกับข้อความจริงในแอพ: ${fixed.length}`)
  for (const [from, to] of fixed) console.log(`   ${JSON.stringify(from)} → ${JSON.stringify(to)}`)
  console.log(`  หาข้อความจริงไม่เจอ        : ${unresolved.length}`)
  for (const u of unresolved) console.log(`   ${JSON.stringify(u)}`)

  if (write && fixed.length) {
    fs.writeFileSync(dictFile + '.bak', raw, 'utf8')
    fs.writeFileSync(dictFile, JSON.stringify(next, null, 2) + '\n', 'utf8')
    console.log(`\nแก้ไฟล์แล้ว: ${dictFile} (สำรอง ${path.basename(dictFile)}.bak)`)
  } else if (fixed.length) {
    console.log('\n(ยังไม่แก้ไฟล์ — ใส่ --write เพื่อแก้)')
  }
  process.exit(unresolved.length ? 1 : 0)
}

if (require.main === module) main()
module.exports = { normalize }
