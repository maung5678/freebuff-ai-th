/*!
 * fbth-th.js — ตัวแปลภาษาไทยสำหรับ UI ของ Freebuff Desktop (ทำงานตอนรัน ไม่ได้แก้โค้ดแอพ)
 *
 * หลักการ
 *  - ทำงานในหน้าตัวอย่าง (renderer) ของแอพ ถูกโหลดจาก index.html ที่ถูก patch
 *  - แปล "ข้อความทั้งก้อน" แบบตรงเป๊ะ (exact match) จากพจนานุกรม fbth-dict.json
 *    → ข้อความที่ไม่รู้จักจะไม่ถูกแตะเลย (ปลอดภัยกับข้อความที่ผู้ใช้/AI พิมพ์)
 *  - รองรับ pattern เช่น "{n} files" และวลี (phrases) สำหรับข้อความผสม
 *  - ใช้ MutationObserver จึงแปลข้อความที่เกิดภายหลัง (React re-render / ข้อความสตรีม)
 *  - ข้ามบริเวณที่ห้ามแปล: โค้ด, เทอร์มินัล, CodeMirror, ช่องพิมพ์, [data-fbth="off"]
 *
 * API สำหรับ debug / เก็บคำที่ยังไม่แปล (ใช้ส่งต่อให้ AI ตัวอื่นทำงานต่อได้)
 *   window.fbth.enable() / disable() / toggle()
 *   window.fbth.stats()             — สถิติการแปล
 *   window.fbth.collect()           — รายการข้อความอังกฤษที่ยังไม่แปล (เรียงตามความถี่)
 *   window.fbth.downloadCandidates()— ดาวน์โหลด JSON ของคำที่ยังไม่แปล
 *   window.fbth.panel()             — เปิด/ปิดแผงเก็บคำที่ยังไม่แปล
 *   window.fbth.reloadDict()        — โหลดพจนานุกรมใหม่จาก fbth-dict.json
 *
 * พจนานุกรมภายนอก: ./fbth-dict.json (โครงสร้างดูใน fbth/dict/th.json)
 */
;(function () {
  'use strict'

  if (window.__fbth && window.__fbth.loaded) return

  var RUNTIME_VERSION = 1

  // ── ค่าคงที่ ────────────────────────────────────────────────────────────────
  var SKIP_ANCESTOR = [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
    'pre', 'code', 'kbd', 'samp', 'textarea', 'select', 'option', 'optgroup',
    '.xterm', '.xterm-rows', '.cm-editor', '.cm-content', '.cm-tooltip', '.monaco-editor',
    '[contenteditable=""]', '[contenteditable="true"]', '[translate="no"]', '[data-fbth="off"]',
  ].join(',')

  // attribute ที่ผู้ใช้เห็นบนหน้าจอ
  // data-tooltip: แอพแสดงทูลทิปจาก attribute นี้โดยตรง (ตัวทูลทิปเองเป็นก้อน DOM แยก)
  //   แปลทั้ง attribute และ text node เพื่อให้ทูลทิปที่เปิดค้างอยู่เปลี่ยนเป็นไทยทันที
  var TEXT_ATTRS = ['placeholder', 'title', 'aria-label', 'aria-description', 'aria-placeholder', 'alt', 'data-placeholder', 'data-tooltip']


  var STORAGE_KEY = 'fbth.missing.v1'
  var ENABLED_KEY = 'fbth.enabled.v1'

  // ── พจนานุกรม (ค่าเริ่มต้นฝังมากับไฟล์, ภายหลังถูกแทนด้วย fbth-dict.json) ──
  var dict = { strings: {}, phrases: {}, patterns: [] }
  if (window.__FBTH_DICT__) dict = normalizeDict(window.__FBTH_DICT__)
  window.__FBTH_DICT__ = null

  var stringMap = Object.create(null)       // ข้อความอังกฤษ → ไทย (ตรงเป๊ะ)
  var phraseRegex = null                    // regex วลี (จับแบบเป็นคำ)
  var patternList = []                      // [{ re, build }]
  var stats = { version: RUNTIME_VERSION, scanned: 0, translated: 0, attrs: 0, patterns: 0, missing: 0, dictSize: 0 }

  function normalizeDict(raw) {
    if (!raw || typeof raw !== 'object') return { strings: {}, phrases: {}, patterns: [] }
    return {
      strings: raw.strings && typeof raw.strings === 'object' ? raw.strings : {},
      phrases: raw.phrases && typeof raw.phrases === 'object' ? raw.phrases : {},
      patterns: Array.isArray(raw.patterns) ? raw.patterns : [],
    }
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }/** แปลง {name} เป็นกลุ่มจับคู่ และสร้างฟังก์ชันประกอบข้อความไทยกลับ */
  function compilePattern(entry) {
    if (!entry || typeof entry.from !== 'string' || typeof entry.to !== 'string') return null
    var names = []
    var body = escapeRe(entry.from).replace(/\\\{([a-zA-Z0-9_]+)(?::([^}]*))?\\\}/g, function (_, name, kind) {
      names.push(name)
      if (kind === 'num') return '(\\d[\\d.,]*)'
      if (kind === 'word') return '([^\\s]+)'
      // ตัวแปรแบบกว้างยอมให้ว่างได้: แอพใช้เทมเพลตแบบ "1 comment${n===1?"":"s"}"
      // พหูพจน์ → ตัวท้ายเป็นค่าว่างได้ (ของเดิม "+" ทำให้รูปเอกพจน์ไม่ถูกแปล)
      return '([\\s\\S]*?)'
    })
    var re, gre
    try {
      re = new RegExp('^' + body + '$')
      gre = new RegExp(body, 'g') // ใช้แทนที่คำกลางข้อความ เช่น "3 files · 12 changes"
    } catch (e) { return null }
    var build = function (m) {
      var out = entry.to
      for (var i = 0; i < names.length; i++) {
        out = out.split('{' + names[i] + '}').join(m[i + 1])
        out = out.split('{' + names[i] + ':num}').join(m[i + 1])
      }
      return out
    }
    return { re: re, gre: gre, build: build }
  }

  function rebuildIndex() {
    stringMap = Object.create(null)
    var keys = Object.keys(dict.strings)
    for (var i = 0; i < keys.length; i++) stringMap[keys[i]] = dict.strings[keys[i]]
    stats.dictSize = keys.length

    var phraseKeys = Object.keys(dict.phrases)
    phraseRegex = null
    if (phraseKeys.length) {
      phraseKeys.sort(function (a, b) { return b.length - a.length })
      var parts = []
      for (var j = 0; j < phraseKeys.length; j++) {
        var k = phraseKeys[j]
        // \b ใช้ได้เฉพาะขอบที่เป็นตัวอักษร/ตัวเลขจริง (คำที่ลงท้ายด้วย "..." หรือ "?" จะไม่มี \b → ไม่เคยแมตช์)
        var head = /^[A-Za-z0-9]/.test(k) ? '\\b' : ''
        var tail = /[A-Za-z0-9]$/.test(k) ? '\\b' : ''
        parts.push(head + escapeRe(k) + tail)
      }
      try { phraseRegex = new RegExp('(' + parts.join('|') + ')', 'g') } catch (e) { phraseRegex = null }
    }

    patternList = []
    for (var p = 0; p < dict.patterns.length; p++) {
      var compiled = compilePattern(dict.patterns[p])
      if (compiled) patternList.push(compiled)
    }
  }

  // ── ตัวแปล ─────────────────────────────────────────────────────────────────
  function translateCore(core) {
    var hit = stringMap[core]
    if (hit !== undefined) return hit

    for (var i = 0; i < patternList.length; i++) {
      var p = patternList[i]
      var m = p.re.exec(core)
      if (m) { stats.patterns++; return p.build(m) }
    }
    return null
  }

  // ข้อความที่ถูกรหัสเพี้ยน (เกิดกับสำเนาแอพที่ถูกสคริปต์ PowerShell เขียนทับ เป็น UTF-8 → Latin-1)
  var MOJIBAKE = [
    ['\u00e2\u20ac\u00a6', '\u2026'],
    ['\u00e2\u20ac\u2122', '\u2019'],
    ['\u00e2\u20ac\u0153', '\u201c'],
    ['\u00e2\u20ac\u009d', '\u201d'],
    ['\u00e2\u20ac\u201c', '\u2013'],
    ['\u00e2\u20ac\u201d', '\u2014'],
    ['\u00c2\u00b7', '\u00b7'],
  ]

  function fixEncoding(text) {
    var out = text
    for (var i = 0; i < MOJIBAKE.length; i++) {
      if (out.indexOf(MOJIBAKE[i][0]) !== -1) out = out.split(MOJIBAKE[i][0]).join(MOJIBAKE[i][1])
    }
    return out
  }

  // ตัวคั่นที่แอพใช้ต่อข้อความหลายส่วนเข้าด้วยกัน (ดูได้จาก data-tooltip ของชิปในแท็บสกิล)
  var SPLIT_SEPARATORS = ['  ', '\n\n']

  /** แปลข้อความที่ต่อกันจากหลายส่วน — คืน null ถ้ามีส่วนใดแปลไม่ได้ (กันข้อความครึ่งไทยครึ่งอังกฤษ) */
  function translateComposed(core) {
    for (var s = 0; s < SPLIT_SEPARATORS.length; s++) {
      var sep = SPLIT_SEPARATORS[s]
      if (core.indexOf(sep) === -1) continue
      var parts = core.split(sep)
      if (parts.length < 2) continue
      var out = []
      var ok = true
      for (var i = 0; i < parts.length; i++) {
        var piece = parts[i]
        var trimmed = piece.trim()
        var hit = trimmed && trimmed.length <= 400 ? translateCore(fixEncoding(trimmed)) : null
        if (hit === null) { ok = false; break }
        var at = piece.indexOf(trimmed)
        out.push(piece.slice(0, at) + hit + piece.slice(at + trimmed.length))
      }
      if (ok) return out.join(sep)
    }
    return null
  }

  /** แปลข้อความหนึ่งก้อน — คืน null ถ้าไม่มีอะไรต้องแก้ */
  function translateText(text) {
    if (!text) return null
    if (text.length > 400) return null
    var raw = text.trim()
    if (!raw) return null
    var core = fixEncoding(raw)

    var exact = translateCore(core)
    if (exact !== null) {
      var lead = text.slice(0, text.indexOf(raw))
      var trail = text.slice(text.indexOf(raw) + raw.length)
      return lead + exact + trail
    }

    // pattern แบบฝังกลางข้อความ (ข้อความสั้นและมีตัวเลข จึงค่อยลอง — ประหยัดเวลา)
    if (patternList.length && core.length <= 140 && /\d/.test(core)) {
      var inline = core
      for (var k = 0; k < patternList.length; k++) {
        var pl = patternList[k]
        if (!pl.gre) continue
        pl.gre.lastIndex = 0
        if (!pl.gre.test(inline)) continue
        pl.gre.lastIndex = 0
        inline = inline.replace(pl.gre, function () { return pl.build(arguments) })
      }
      if (inline !== core) return inline
    }

    // ข้อความที่แอพ "ประกอบ" ขึ้นมาจากหลายส่วน: ทูลทิปสกิล = คำอธิบาย + "  Edit skill"
    // แปลทีละส่วน (ต้องได้ครบทุกส่วน ไม่งั้นจะกลายเป็นไทยครึ่งอังกฤษ)
    var composed = translateComposed(core)
    if (composed !== null) return composed

    if (phraseRegex && core.length < 200) {
      phraseRegex.lastIndex = 0
      if (phraseRegex.test(core)) {
        phraseRegex.lastIndex = 0
        var out = core.replace(phraseRegex, function (whole) { return dict.phrases[whole] || whole })
        if (out !== core) return out
      }
    }
    return null
  }

  // ── เก็บคำที่ยังไม่แปล (ไว้ส่งต่อให้คน/AI ตัวอื่นแปลเพิ่ม) ─────────────────
  var missing = loadMissing()
  var dictReady = false

  function loadMissing() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch (e) {}
    return {}
  }

  var persistTimer = null
  function persistMissing() {
    if (persistTimer) return
    persistTimer = setTimeout(function () {
      persistTimer = null
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(missing)) } catch (e) {}
    }, 1500)
  }

  function looksLikeUi(s) {
    if (s.length < 2 || s.length > 120) return false
    if (!/^[A-Za-z]/.test(s)) return false
    if (!/[A-Za-z]{2,}/.test(s)) return false
    if (/[\\{}<>=$|~^`]/.test(s)) return false
    if (s.indexOf('://') !== -1) return false
    if (/^[\w.-]+\.(js|ts|tsx|jsx|json|css|html|md|png|svg|txt|py|sh|exe|cjs|mjs)$/i.test(s)) return false
    if (/^[A-Z_]{2,}$/.test(s)) return false
    return true
  }

  function noteMissing(core, el) {
    // ยังไม่โหลดพจนานุกรม = การกวาดรอบแรกยังไม่รู้จักคำอะไรเลย → อย่าจดเป็น "คำที่ยังไม่แปล"
    // (ไม่งั้นคลังคำจะเต็มไปด้วยคำที่จริง ๆ แปลได้ เช่น Run / left / Working…)
    if (!dictReady) return
    if (!looksLikeUi(core)) return
    var rec = missing[core]
    if (rec) { rec.n++; return }
    if (Object.keys(missing).length > 4000) return
    missing[core] = { n: 1, tag: el && el.tagName ? el.tagName.toLowerCase() : '?' }
    stats.missing++
    persistMissing()
  }

  // ── การเดินบน DOM ─────────────────────────────────────────────────────────
  var skipCache = new WeakMap()
  var originalText = new WeakMap()   // ข้อความอังกฤษต้นฉบับ (กันการแปลซ้ำซ้อน)

  function isSkipped(el) {
    if (!el) return true
    var cached = skipCache.get(el)
    if (cached !== undefined) return cached
    var result
    try { result = !!el.closest(SKIP_ANCESTOR) } catch (e) { result = false }
    skipCache.set(el, result)
    return result
  }

  function inTranscript(el) {
    try { return !!el.closest('[role="log"],[role="article"],[data-fbth-collect="off"]') } catch (e) { return false }
  }

  function translateTextNode(node, allowCollect) {
    if (!node || node.nodeType !== 3) return
    var parent = node.parentNode
    if (!parent || parent.nodeType !== 1) return
    if (isSkipped(parent)) return
    var value = node.nodeValue
    if (!value) return
    stats.scanned++
    var out = translateText(value)
    if (out === null) {
      if (allowCollect !== false && !inTranscript(parent)) noteMissing(value.trim(), parent)
      return
    }
    if (out === value) return
    originalText.set(node, value)
    node.nodeValue = out
    stats.translated++
  }

  /** element เองห้ามแปล attribute เฉพาะกรณีที่ผู้ใช้สั่งห้ามไว้
   *  (input/textarea ต้องแปล placeholder ได้ แต่ห้ามแปลข้อความข้างใน) */
  function attrsAllowed(el) {
    if (!el || el.nodeType !== 1) return false
    try {
      if (el.matches('[data-fbth="off"],[translate="no"],[contenteditable=""],[contenteditable="true"]')) return false
    } catch (e) {}
    var parent = el.parentElement
    if (!parent) return true
    return !isSkipped(parent)
  }

  function translateAttrs(el) {
    if (!el || el.nodeType !== 1) return
    if (!attrsAllowed(el)) return
    for (var i = 0; i < TEXT_ATTRS.length; i++) {
      var name = TEXT_ATTRS[i]
      if (!el.hasAttribute(name)) continue
      var raw = el.getAttribute(name)
      if (!raw) continue
      var out = translateText(raw)
      if (out !== null && out !== raw) {
        el.setAttribute(name, out)
        stats.attrs++
      }
    }
  }

  function walk(root, allowCollect) {
    if (!root) return
    if (root.nodeType === 3) { translateTextNode(root, allowCollect); return }
    if (root.nodeType !== 1 && root.nodeType !== 9) return
    var el = root.nodeType === 1 ? root : null
    if (el && isSkipped(el)) return
    if (el) translateAttrs(el)
    var doc = root.ownerDocument || document
    var walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null)
    var node
    while ((node = walker.nextNode())) {
      if (node.nodeType === 3) translateTextNode(node, allowCollect)
      else translateAttrs(node)
    }
  }

  // ── MutationObserver: แปลสิ่งที่เกิดใหม่ (React, ข้อความสตรีม) ─────────────
  var queue = []
  var scheduled = false

  function schedule(node, allowCollect) {
    queue.push([node, allowCollect])
    if (scheduled) return
    scheduled = true
    var run = function () {
      scheduled = false
      var batch = queue
      queue = []
      for (var i = 0; i < batch.length; i++) {
        try { walk(batch[i][0], batch[i][1]) } catch (e) {}
      }
    }
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run)
    else setTimeout(run, 16)
  }

  var observer = null

  function isOurOwnChange(target) {
    if (!target) return false
    if (target.nodeType === 3 && originalText.has(target)) {
      if (target.nodeValue === translateText(originalText.get(target)) || translateText(target.nodeValue) === null) {
        originalText.delete(target)
        return true
      }
    }
    return false
  }

  function startObserver() {
    if (observer) return
    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i]
        if (m.type === 'childList') {
          for (var a = 0; a < m.addedNodes.length; a++) {
            var added = m.addedNodes[a]
            if (added.nodeType === 3 && added.parentNode && added.parentNode.nodeType === 1) {
              if (!isSkipped(added.parentNode)) schedule(added)
            } else if (added.nodeType === 1) {
              schedule(added)
            }
          }
        } else if (m.type === 'characterData') {
          if (!isOurOwnChange(m.target) && !(m.target.parentNode && isSkipped(m.target.parentNode))) {
            schedule(m.target)
          }
        } else if (m.type === 'attributes') {
          if (!isSkipped(m.target)) schedule(m.target)
        }
      }
    })
    observer.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: TEXT_ATTRS,
    })
  }

  // ── ปรับภาษา/ฟอนต์ของเอกสาร ──────────────────────────────────────────────
  function applyDocumentLocale() {
    try {
      document.documentElement.setAttribute('lang', 'th')
      document.documentElement.setAttribute('data-fbth-locale', 'th')
      if (!document.getElementById('fbth-style')) {
        var style = document.createElement('style')
        style.id = 'fbth-style'
        // ไม่ทับฟอนต์เดิมของแอพ — แค่ต่อท้ายด้วยฟอนต์ไทยที่ Chromium จะใช้เมื่อต้องแสดงอักษรไทย
        style.textContent =
          ':root{--fbth-thai-font:"Leelawadee UI","Sarabun","Noto Sans Thai","Tahoma",sans-serif}' +
          'html[lang="th"] body{font-family:inherit}'
        document.head.appendChild(style)
      }
    } catch (e) {}
  }

  // ── API สาธารณะ ───────────────────────────────────────────────────────────
  var enabled = true
  try { enabled = localStorage.getItem(ENABLED_KEY) !== '0' } catch (e) {}

  function run(allowCollect) {
    if (!enabled) return
    applyDocumentLocale()
    walk(document.body || document.documentElement, allowCollect)
    var t = document.title
    if (t) {
      var out = translateText(t)
      if (out !== null && out !== t) document.title = out
    }
  }

  var api = {
    loaded: true,
    version: RUNTIME_VERSION,
    translate: translateText,
    fixEncoding: fixEncoding,
    run: function () { run(false) },
    enable: function () {
      enabled = true
      try { localStorage.setItem(ENABLED_KEY, '1') } catch (e) {}
      startObserver(); run(true)
      return 'enabled'
    },
    disable: function () { enabled = false; try { localStorage.setItem(ENABLED_KEY, '0') } catch (e) {}; return 'disabled' },
    toggle: function () { return enabled ? api.disable() : api.enable() },
    isEnabled: function () { return enabled },
    stats: function () {
      return {
        version: RUNTIME_VERSION,
        enabled: enabled,
        dictSize: stats.dictSize,
        patterns: patternList.length,
        phrases: Object.keys(dict.phrases).length,
        scanned: stats.scanned,
        translated: stats.translated,
        attrs: stats.attrs,
        templateHits: stats.patterns,
        missingCount: Object.keys(missing).length,
      }
    },
    collect: function (limit) {
      var out = Object.keys(missing).map(function (k) { return { text: k, count: missing[k].n, tag: missing[k].tag } })
      out.sort(function (a, b) { return b.count - a.count || a.text.localeCompare(b.text) })
      return limit ? out.slice(0, limit) : out
    },
    clearCollected: function () {
      missing = {}
      try { localStorage.removeItem(STORAGE_KEY) } catch (e) {}
      return 'cleared'
    },
    downloadCandidates: function () {
      var data = {
        generatedAt: new Date().toISOString(),
        source: 'fbth runtime collector',
        total: Object.keys(missing).length,
        strings: Object.keys(missing).map(function (k) { return k }),
      }
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      var a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'fbth-candidates-' + new Date().toISOString().slice(0, 10) + '.json'
      document.body.appendChild(a)
      a.click()
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove() }, 1000)
      return data.total
    },
    reloadDict: function () {
      return fetch('./fbth-dict.json?ts=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (j) {
          if (!j) return null
          dict = normalizeDict(j); rebuildIndex(); run(false)
          return api.stats()
        })
        .catch(function () { return null })
    },
    panel: function () {
      var existing = document.getElementById('fbth-panel')
      if (existing) { existing.remove(); return 'closed' }
      var list = api.collect(400)
      var box = document.createElement('div')
      box.id = 'fbth-panel'
      box.setAttribute('data-fbth', 'off')
      box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(520px,80vw);max-height:60vh;' +
        'overflow:auto;background:#15171a;color:#e5e7eb;border:1px solid #2a2d32;border-radius:12px;padding:12px;' +
        'font:12px/1.5 ui-monospace,Consolas,monospace;box-shadow:0 18px 60px rgb(0 0 0/45%)'
      var head = document.createElement('div')
      head.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px'
      head.innerHTML = '<strong style="flex:1">fbth · คำที่ยังไม่แปล (' + list.length + ')</strong>'
      var copy = document.createElement('button')
      copy.textContent = 'คัดลอกทั้งหมด'
      copy.style.cssText = 'padding:4px 8px;border-radius:6px;border:1px solid #3a3f45;background:#22262b;color:inherit;cursor:pointer'
      copy.onclick = function () {
        var text = list.map(function (x) { return x.text }).join('\n')
        if (navigator.clipboard) navigator.clipboard.writeText(text)
        copy.textContent = 'คัดลอกแล้ว'
      }
      head.appendChild(copy)
      box.appendChild(head)
      var pre = document.createElement('div')
      pre.style.whiteSpace = 'pre-wrap'
      pre.textContent = list.map(function (x) { return x.count + '  ' + x.text }).join('\n')
      box.appendChild(pre)
      document.body.appendChild(box)
      return 'open'
    },
    __missing: missing,
  }

  window.__fbth = api
  window.fbth = api

  // ── โหลดพจนานุกรมภายนอก แล้วเริ่มทำงาน ────────────────────────────────────
  function boot() {
    rebuildIndex()
    run(true)
    startObserver()
    // ให้ React แสดงผลรอบแรกเสร็จก่อน แล้วกวาดอีกรอบ
    setTimeout(function () { run(true) }, 300)
    setTimeout(function () { run(true) }, 1500)
    startUsageSnapshot()
  }

  // ส่ง snapshot โควตาให้ shell บันทึกลงโปรไฟล์ของแต่ละ clone
  function startUsageSnapshot() {
    function capture() {
      try {
        var parts = []
        var root = document.querySelector('.freebucks-stats,[aria-label="Free sessions"],[aria-label="Plan usage"]') || document.body
        if (!root) return
        parts.push(root.textContent || '')
        var hinted = root.querySelectorAll('[title],[data-tooltip],[aria-label]')
        for (var i = 0; i < hinted.length; i++) parts.push(hinted[i].getAttribute('title') || hinted[i].getAttribute('data-tooltip') || hinted[i].getAttribute('aria-label') || '')
        var text = parts.join(' ').replace(/\s+/g, ' ')
        var exact = text.match(/([\d,]+)\s+of today(?:'|’)?s\s+([\d,]+)\s+Freebucks left/i)
        var daily = text.match(/([\d,]+)\s*daily\s*resets in\s*((?:\d+\s*[dhm]\s*)+)/i)
        var legacy = text.match(/([\d,]+)\s*\/\s*([\d,]+).*?daily.*?resets in\s*((?:\d+\s*[dhm]\s*)+)/i)
        var remaining = exact ? Number(exact[1].replace(/,/g, '')) : legacy ? Number(legacy[1].replace(/,/g, '')) : daily ? Number(daily[1].replace(/,/g, '')) : null
        var limit = exact ? Number(exact[2].replace(/,/g, '')) : legacy ? Number(legacy[2].replace(/,/g, '')) : null
        var delay = legacy ? legacy[3] : daily ? daily[2] : null
        if (remaining === null && !delay) return
        var resetAt = null
        if (delay) {
          var ms = 0, re = /(\d+)\s*([dhm])/ig, m
          while ((m = re.exec(delay))) ms += Number(m[1]) * (m[2].toLowerCase() === 'd' ? 86400000 : m[2].toLowerCase() === 'h' ? 3600000 : 60000)
          if (ms) resetAt = new Date(Date.now() + ms).toISOString()
        }
        console.info('__FBTH_USAGE__' + JSON.stringify({ remaining: remaining, limit: limit, resetAt: resetAt, capturedAt: new Date().toISOString() }))
      } catch (e) {}
    }
    setTimeout(capture, 2500)
    setInterval(capture, 60000)
  }

  function loadExternalDict() {
    if (!window.fetch) { dictReady = true; boot(); return }
    fetch('./fbth-dict.json?v=' + RUNTIME_VERSION, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) { if (j) dict = normalizeDict(j) })
      .catch(function () {})
      .then(function () { dictReady = true; boot() })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadExternalDict)
  else loadExternalDict()
})()
