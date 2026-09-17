# HANDOFF.md — สถานะและสถาปัตยกรรม (สำหรับ AI/คนที่มาทำงานต่อ)

อัปเดตล่าสุด: 2026-09-16 (รอบ 4: แปลทูลทิป/คำอธิบายสกิล + ตรวจข้อความจาก orchestrator + ชุดส่งเพื่อน v4) · แอพเป้าหมาย: Freebuff Desktop v0.0.112 (Electron + Bun orchestrator)

---

## 1. สรุปงานที่ทำเสร็จแล้ว

| ส่วน | สถานะ |
|---|---|
| แปล UI ทั้งแอพ (renderer) | ✅ พจนานุกรมรวม **1,421 คีย์ + 222 pattern + 7 phrase** (ติดตั้งจริงเป็น 1,491 คำ เมื่อรวมคำของ shell) |
| ปิดช่องว่างคำที่ยังไม่แปล | ✅ **0 คำ ค้าง · 0 pattern ค้าง** — ตรวจครบทั้ง 5 ไฟล์ `candidates*.json` (เดิมค้าง 157 คำ + 133 pattern) |
| แปลเมนู native + dialog (shell) | ✅ 76 คำ + 4 pattern (เมนู File/Edit/View/Window/Help, กล่องข้อความ, dialog ไฟล์) |
| ติดตั้งลงแอพจริง | ✅ 9 ที่ติดตั้ง (ตัวหลัก + clones A–G, 191) — ทั้ง UI และเมนู |
| ตรวจสอบกับบันเดิลจริง | ✅ `check-dict.js` → "คีย์ที่ไม่พบบันเดิล: 0" (ทั้ง UI และ shell) |
| ทดสอบในเบราว์เซอร์จริง | ✅ `dev/bench-inline.html` (สร้างจาก `fbth bench`) ผ่าน 19/19 · โหลด UI จริงของแอพแล้วเห็นไทย |
| ทดสอบเมนูจริง | ✅ เปิดแอพจริง (clone G และตัวติดตั้งหลักด้วย profile ชั่วคราว) แล้ว `shell.log` แสดงเมนูเป็นไทยครบทุกข้อ |
| รองรับแอพอัปเดต | ✅ patcher idempotent + ตัวเรียกแอพที่ re-patch อัตโนมัติ (ทั้ง UI และ shell) + เครื่องมือดึงคำใหม่ |
| รองรับ AI ตัวอื่นมาทำต่อ | ✅ AGENTS.md + dict แยกไฟล์ + TODO.md + ตัวเก็บคำที่ยังไม่แปลในแอพ + shell.log |
| ชุดติดตั้งส่งต่อให้เครื่องอื่น (Thai Pack) | ✅ `fbth/tools/build-pack.js` → `build/Freebuff-Thai-Pack/` + `Freebuff-Thai-Pack-v4.zip` (143 KB) — เครื่องปลายทางไม่ต้องมี Node (ใช้ bun/node/Electron ของแอพ) |
| ทดสอบอัตโนมัติในแซนด์บ็อกซ์ | ✅ `dev/selftest-pack.cjs` → ผ่าน 53/53 ข้อ (ทั้ง payload ต้นทางและ payload ในชุด v4) — ติดตั้ง → ซ้ำ → สถานะ → ถอด คืนค่าเป๊ะทุกไบต์ และ **ไม่แตะแอพที่ติดตั้งจริงเลย** |
| ทดสอบตัวแปลในเบราว์เซอร์จริง | ✅ `dev/bench-inline.html` (สร้างโดย `fbth bench`) ผ่าน **19/19** รวม ทูลทิปสกิลที่ตัดจาก prompt, ทูลทิปที่ต่อด้วย “Edit skill”, attribute `data-tooltip`, ข้อความ error ของระบบสกิล |
| ทูลทิป/คำอธิบายของ **สกิล** (แท็บ “สกิล”) | ✅ แปลครบ 42 ข้อความ: คำอธิบายสกิล 21 ตัว + ทูลทิปของ review/test/commit (ตัดจาก prompt ความยาว 220 ตัวอักษร) + ข้อความ error ของระบบสกิล · แตกใหม่ได้ด้วย `extract-orchestrator-strings.js` |
| ตรวจข้อความที่ผู้ใช้เห็นจาก orchestrator | ✅ `fbth/tools/extract-orchestrator-strings.js` + `candidates-orchestrator.json` ต่อเข้า check-dict/dict-tools แล้ว (ข้อความกลุ่มนี้ไม่เคยถูกสแกนมาก่อน) |
| งานที่เหลือ | ⏳ ดูข้อ 8 (ข้อความ error ของ API อีก ~89 ข้อความ, หน้าต่าง consent บางข้อความ) |

## 2. สถาปัตยกรรมแอพ (สิ่งที่ค้นพบ)

```
%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop\      ← ตัวติดตั้งหลัก
├─ Freebuff.exe
└─ resources\
   ├─ app.asar                 ← โค้ด Electron main (shell) — ห้ามแตะ
   ├─ bun\bun.exe              ← รัน orchestrator
   └─ orchestrator\
      ├─ orchestrator.js       ← เซิร์ฟเวอร์ API + เสิร์ฟ UI (Bun) — ห้ามแตะ
      └─ ui\                   ← ★ UI จริง (React + Vite build) — จุดที่เราแก้ได้
         ├─ index.html                 (แก้: แทรกสคริปต์ + แปลข้อความ static)
         ├─ fbth-th.js                 (ของเรา: ตัวแปลตอนรัน)
         ├─ fbth-dict.json             (ของเรา: พจนานุกรมที่ merge แล้ว)
         ├─ index.html.fbth-original   (สำรองต้นฉบับ)
         ├─ index.html.fbth-state.json (บันทึกเวอร์ชัน/แฮชที่ติดตั้ง)
         └─ assets\index-*.js          (bundle React — "ห้ามแก้")

%LOCALAPPDATA%\Freebuff-Clones\Freebuff A..G, 191\   ← สำเนาแอพ (คนละ account/profile)
```

**กลไกการเสิร์ฟ UI** (`orchestrator.js` ฟังก์ชัน `serveSpa`):
- path ใดก็ได้ที่อยู่ใต้ `ui/` และมีไฟล์จริง จะถูกเสิร์ฟ → ไฟล์ใหม่ของเราถูกเสิร์ฟได้เลย
- CSP มีแค่ `frame-ancestors 'none'` → สคริปต์ภายนอก/อินไลน์โหลดได้
- หน้าต่างแอพโหลด `http://127.0.0.1:<port>/` → ใช้ path แบบ relative (`./fbth-th.js`) ได้

**ทางเลือกที่ถูกตัดออกไป (พร้อมเหตุผล)**
- ❌ แก้ bundle `assets/index-*.js` แบบแทนสตริง: เปราะ หายทุกอัปเดต และอ่านไม่ออก
- ❌ แตก `app.asar` → `resources/app`: Electron ให้ความสำคัญกับโฟลเดอร์ `app` มากกว่า asar
  ถ้าอัปเดตแล้ว asar ใหม่ถูกวางทับ แต่โฟลเดอร์ `app` ยังเก่า → แอพจะรันโค้ดเก่า (อันตราย)
- ✅ เลือก "พจนานุกรม + ตัวแปลตอนรัน" เพราะปลอดภัย อัปเดตได้ และต่อยอดได้โดยไม่ต้อง repack

## 3. โครงสร้างไฟล์ในโปรเจกต์นี้

```
Freebuff AI TH\
├─ AGENTS.md                  คำสั่ง/guardrails สำหรับ AI
├─ HANDOFF.md                 ไฟล์นี้
├─ README-TH.md               คู่มือผู้ใช้ (ไทย)
├─ Freebuff-TH.cmd            ตัวเรียกแอพ: ตรวจ+ติดตั้งการแปล แล้วเปิดแอพ
├─ fbth\
│  ├─ lib\asar.js             อ่าน/เขียน app.asar แบบคงความยาวไบต์ (ไม่พึ่งไลบรารี)
│  ├─ shell\shell.cjs         ตัวแปลฝั่ง Electron main (เมนู native / dialog)
│  ├─ fbth.js                 CLI: install / uninstall / status / ensure / launch / where / shell-log / bench
│  ├─ runtime\fbth-th.js      ตัวแปลที่รันในหน้าแอพ (DOM + MutationObserver)
│  ├─ dict\
│  │  ├─ th.json              พจนานุกรมหลัก (เรียงตามพื้นที่ของ UI) · รวมทุกไฟล์ 1,092 คำ + pattern 87
│  │  ├─ th-app.json          ชุดที่ 2 (หน้าจอที่ครอบคลุมเพิ่ม)
│  │  ├─ th-app2.json         ชุดที่ 3 ★ ไฟล์ th-*.json ใหม่ถูก merge อัตโนมัติ
│  │  ├─ th-app3.json         ชุดที่ 4 — ข้อความ validation/error + pattern ที่มีตัวแปร
│  │  ├─ th-app4.json         ชุดที่ 5 — แท็บ/คิว/มิชชัน/สปอนเซอร์/ตัวอย่าง
│  │  ├─ th-app5.json         ชุดที่ 6 — ป้ายสั้น ๆ (Find/Replace/Expand…) + ข้อความยาวที่เหลือ
│  │  ├─ th-extra.json        ชุดเสริม (ประโยคยาว + pattern ของ error)
│  │  ├─ th-skills.json       ★ ชุดที่ 7 — ทูลทิป/คำอธิบายสกิล + ข้อความ error ของระบบสกิล
│  │  ├─ candidates-orchestrator.json  ข้อความ UI ที่ดึงจาก orchestrator.js (42 คำ · สร้างด้วย extract-orchestrator-strings.js)
│  │  ├─ shell-th.json        คำของเมนู native/dialog (ใช้เฉพาะส่วน shell)
│  │  ├─ ignore.json          รายการ "ไม่แปลโดยเจตนา" + เหตุผล (ภาษา/แบรนด์/ภายในไลบรารี)
│  │  ├─ gap-all.json / gap-ui.json  ผลตรวจช่องว่างของพจนานุกรม (gap-report)
│  │  ├─ gap-todo.json        รายการที่ยังไม่แปล/ไม่แมตช์ (สร้างด้วย check-dict --todo-json)
│  │  ├─ removed.json         คำที่ถูกตัดออก (รวมคำของเมนู native ที่ยังไม่ได้ใช้)
│  │  ├─ candidates.json      ข้อความทั้งหมดที่ดึงได้จาก bundle (1715)
│  │  ├─ candidates-jsx.json  ข้อความที่ยืนยันว่าอยู่บนหน้าจอ (537) ★ ใช้เป็น checklist
│  │  └─ TODO.md              รายการคำที่ยังไม่แปล (สร้างด้วย dict-tools)
│  └─ tools\
│     ├─ build-pack.js        ★ ประกอบ "ชุดติดตั้งภาษาไทย" (.zip) สำหรับส่งต่อ
│     ├─ extract-strings.js   ดึงข้อความ UI จาก bundle (โหมด --jsx แม่นยำสูง)
│     ├─ extract-shell-strings.js  ดึงข้อความใหม่จาก app.asar (ส่วน shell)
│     ├─ extract-orchestrator-strings.js  ★ ดึงทูลทิปสกิล/ข้อความ error จาก orchestrator.js (คำนวณทูลทิปให้ตรงกับ UI จริง)
│     ├─ gap-report.js        เทียบข้อความที่สแกนได้กับพจนานุกรม → เหลืออะไรที่ควรแปล
│     ├─ dict-normalize.js    ทำความสะอาดคีย์ (อักขระพิเศษ/ช่องว่าง)
│     ├─ check-dict.js        ตรวจพจนานุกรมกับบันเดิลจริง + ตรวจ pattern
│     ├─ read-fuses.js        อ่านค่า fuses ของแอพ (ว่าอะไรแก้ได้/ไม่ได้)
│     └─ dict-tools.js        prune (ลบคำตาย) / todo (สร้างรายการงาน) / stats
└─ dev\
   ├─ bench.html              หน้าทดสอบตัวแปล (ตรวจอัตโนมัติ 19 ข้อ)
   ├─ bench-inline.html       ← สร้างด้วย `fbth bench` (runtime+พจนานุกรมฝังใน เปิดเดี่ยว ๆ ได้เพื่อดูผล)
   ├─ selftest-pack.cjs       ★ ทดสอบ ติดตั้ง/ถอด แบบครบวงจรในแซนด์บ็อกซ์ (ไม่แตะแอพจริง)
   ├─ make-virgin-asar.cjs    ตัวช่วย: คืน slot หัวไฟล์ app.asar เป็นของเดิม (จำลองเครื่องใหม่)
   ├─ serve.js                เซิร์ฟเวอร์ไฟล์นิ่ง (--dir เพื่อเปิด UI จริงของแอพ)
   ├─ fbth-th.js / fbth-dict.json  ← ไฟล์ที่สร้างด้วย `fbth bench` (ไม่ต้องแก้มือ)
└─ build\
   ├─ Freebuff-Thai-Pack\     ← ชุดที่สร้างด้วย build-pack.js (ส่งให้เพื่อนได้ทั้งโฟลเดอร์)
   └─ Freebuff-Thai-Pack-v4.zip
```

## 4. ตัวแปลทำงานอย่างไร (`runtime/fbth-th.js`)

1. โหลดพจนานุกรมจาก `./fbth-dict.json` (มี fallback ในตัวถ้า fetch ล้มเหลว)
2. ตั้ง `document.documentElement.lang = 'th'` เพื่อให้ Chromium เลือกฟอนต์ไทยถูกตัว
3. เดินบน DOM: แปล **text node** และ attribute ที่ผู้ใช้เห็น (`placeholder`, `title`, `aria-label`, `aria-description`, `aria-placeholder`, `alt`, `data-placeholder`, `data-tooltip`)
4. ลำดับการจับคู่: `strings` (ตรงทั้งก้อน หลังตัดช่องว่างหัว-ท้าย) → `patterns` (แบบยึดทั้งข้อความ แล้วค่อยแบบฝังกลางข้อความ เมื่อข้อความสั้นและมีตัวเลข)
   → **ข้อความที่แอพต่อจากหลายส่วน** (แยกที่ `"  "` หรือ `"\n\n"` แล้วแปลทีละส่วน ต้องได้ครบทุกส่วน) → `phrases` (แทนที่กลางข้อความ)
5. `MutationObserver` (childList/characterData/attributes) จับงานเป็นชุดด้วย `requestAnimationFrame` → ครอบคลุม React re-render และข้อความที่สตรีมเข้ามา
6. **ห้ามแปล** ใน: `script/style/svg/canvas/iframe/pre/code/kbd/samp`, `textarea/select/option` (แต่ยังแปล placeholder ของ `input/textarea` ได้), `.xterm`, `.cm-editor`, `[contenteditable]`, `[translate="no"]`, `[data-fbth="off"]`
7. เก็บคำที่ยังไม่แปลไว้ใน `localStorage` (คีย์ `fbth.missing.v1`) และจำกัดการเก็บใน `[role="log"],[role="article"]` เพื่อไม่ปนข้อความของ AI

**API ในหน้าแอพ (กด F12 → Console)**
```js
fbth.stats()                 // สถิติการแปล
fbth.collect(50)             // คำที่ยังไม่แปล (เรียงตามความถี่)
fbth.downloadCandidates()    // ดาวน์โหลด JSON ของคำที่ยังไม่แปล
fbth.panel()                 // เปิดแผงดู/คัดลอกคำที่ยังไม่แปล
fbth.reloadDict()            // โหลดพจนานุกรมใหม่โดยไม่ต้องรีสตาร์ท
fbth.disable() / enable()    // ปิด/เปิดการแปลชั่วคราว
```

## 5. หลังแอพอัปเดตต้องทำอะไร (สำคัญ)

แอพอัปเดต = `app.asar`, `orchestrator.js` และ `ui/` ถูกแทนที่ → **การแปลหายทั้งหมด**
(พจนานุกรมต้นทางในโปรเจกต์ไม่หาย — แค่ต้องติดตั้งใหม่)

1. ใช้ `Freebuff-TH.cmd` เปิดแอพ → `fbth ensure` จะติดตั้งการแปลให้อัตโนมัติถ้ายังไม่มี/เก่า
2. ตรวจว่าข้อความยังตรงกับพจนานุกรม: `node fbth/tools/check-dict.js`
   - มี "คีย์ที่ไม่พบบันเดิล" → แอปเปลี่ยนถ้อยคำ: รัน `node fbth/tools/dict-tools.js prune --write`
3. เก็บคำใหม่: `node fbth/tools/extract-strings.js --jsx --auto --json fbth/dict/candidates-jsx.json`
   แล้ว `node fbth/tools/dict-tools.js todo --write` → แปลจาก `fbth/dict/TODO.md` เข้าไฟล์ `th-*.json` ใหม่
4. `node fbth/fbth.js install` → `ctrl+R` ในแอพ หรือปิด-เปิดใหม่
5. อัปเดตชุดที่ส่งให้เพื่อน: `node fbth/tools/build-pack.js` แล้ว `node dev/selftest-pack.cjs --payload build/Freebuff-Thai-Pack/payload/fbth`

`fbth status` จะเตือนเองว่า "แอพอัปเดตแล้ว (bundle เปลี่ยน)" เมื่อชื่อไฟล์ bundle เปลี่ยนจากที่บันทึกไว้

## 6. ส่วน shell (เมนู native) ทำงานอย่างไร — เฟส 2

`fbth install` ติดตั้งทั้งสองชั้น: UI (ข้อ 4) และ shell

### โครงสร้าง
```
<install>/resources/
  app.asar                 ← โค้ด Electron main (แก้แบบคงความยาวไบต์เท่านั้น)
  app/electron/main.cjs    ← สำเนาที่แตกไว้ (clone) — patch เพิ่มเพื่อทนการ repack ของสคริปต์ clone
  fbth/                    ← ไฟล์ของเรา
    shell.cjs              ตัวแปล main process (hook Menu/dialog + ฉีดตัวแปล DOM)
    shell-dict.json        พจนานุกรม = UI ทั้งหมด + คำของ shell (merge ให้อัตโนมัติ)
    renderer.js            สำเนาของ runtime/fbth-th.js (ฉีดเข้าหน้าต่าง consent/splash)
    shell.log              บันทึกการทำงาน (ใช้ยืนยัน/ตรวจสอบ)
    state.json             โหมดที่ใช้ + ไบต์เดิมของช่องที่ถูกแทน (ไว้คืนค่า)
```

### วิธีแทรก (สำคัญ — อย่าทำมือ)
1. **asar mode (ตัวติดตั้งหลัก)**: `electron/main.cjs` เริ่มด้วยคอมเมนต์
   `/** ... Freebuff — Electron main process ... */` → แทนคอมเมนต์นี้ด้วย
   `;require(process.resourcesPath+'/fbth/shell.cjs');//fbth-shell-inject` + คอมเมนต์ถมช่องให้
   **ยาวเท่าเดิมทุกไบต์** → header/offset ของไฟล์อื่นใน asar ไม่ต้องคำนวณใหม่
   ก่อนเขียน: ตรวจ syntax ด้วย `vm.Script` ทั้งไฟล์ (ถ้าไฟล์เดิม compile ไม่ผ่านก็ข้ามการตรวจ)
   ไบต์เดิมของช่องถูกเก็บ base64 ใน `state.json` → `uninstall-shell` คืนค่าได้แม่นยำ
2. **file mode (clone ที่มี `resources/app`)**: ต่อท้าย `main.cjs` หนึ่งบรรทัด (สำรองเป็น
   `main.cjs.fbth-original`) — เพราะเรา patch ตัว asar ด้วย จึงทนการ repack ของสคริปต์ clone
3. ตอนโหลด: `shell.cjs` hook `Menu.buildFromTemplate` / `Menu.setApplicationMenu`
   (รวม label ที่ Electron สร้างให้ role: Edit/Undo/Cut/Zoom In/Toggle Developer Tools/…),
   `dialog.showMessageBox(Sync)` / `showOpenDialog` / `showSaveDialog` / `showErrorBox`
   และ `app.on('web-contents-created')` → ฉีดตัวแปล DOM เข้าหน้าต่างที่ shell เปิดเอง

### ตรวจสอบว่าเมนูเป็นไทยจริง
`node fbth/fbth.js shell-log` (หรือเปิดไฟล์ `resources/fbth/shell.log`) จะเห็น menu dump ล่าสุด
บนเครื่องนี้ยืนยันแล้วทั้ง clone (file+asar) และตัวติดตั้งหลัก (asar)

### กว่าจะได้มาซึ่งวิธีนี้ (สิ่งที่ลองแล้วไม่สำเร็จ — อย่าเสียเวลาซ้ำ)
- `NODE_OPTIONS=--require=...` → Electron กรองออปชันที่โหลดโค้ดออก แม้ fuse จะเปิด
- พึ่ง `resources/app` อย่างเดียว → **asar ชนะ** (ทดสอบแล้ว) จึงต้อง patch asar
- ตัวสคริปต์ clone (PowerShell) ทำ mojibake ให้ shell ของ clone → ต้องมี `fixEncoding()`

## 7. ชุดติดตั้งสำหรับเครื่องอื่น (Thai Pack) — เฟส 3

เครื่องปลายทางไม่ต้องมีโปรเจกต์นี้ และไม่ต้องติดตั้ง Node เพิ่ม

```
node fbth/tools/build-pack.js        # → build/Freebuff-Thai-Pack/ + Freebuff-Thai-Pack-v4.zip
```

```
build/Freebuff-Thai-Pack/
├─ ติดตั้งภาษาไทย.cmd / install-th.cmd     (ชื่อไทย + ชื่อ ASCII อย่างละชุด)
├─ ถอดภาษาไทย.cmd / uninstall-th.cmd
├─ ตรวจภาษาไทย.cmd / status-th.cmd
├─ เปิด Freebuff ไทย.cmd / launch-th.cmd   (ensure + launch ไม่หยุดรอ)
├─ run-fbth.cmd       ← เลือกตัวรัน: bun.exe ของแอพ → node → Freebuff.exe (ELECTRON_RUN_AS_NODE)
├─ payload/fbth/      ← fbth.js + lib + runtime + shell + dict (ตัด candidates/gap/TODO ออก)
└─ README-ไทย.md / วิธีใช้.txt
```

- `FBTH_APP=<โฟลเดอร์แอพ>` หรือไฟล์ `app-path.txt` = "เอาเฉพาะโฟลเดอร์นี้" (run-fbth.cmd จะส่ง `--app` ต่อ)
  → ติดตั้งเฉพาะสำเนา/clone ที่ต้องการโดยไม่ไปแตะตัวอื่นได้
- ตัวเรียกเรียกเป็น `fbth.js <คำสั่ง> [อาร์กิวเมนต์ของผู้ใช้] [--app path]` — **คำสั่งต้องมาก่อนเสมอ**

### การทดสอบ (รันก่อนส่งทุกครั้ง)

```
node dev/selftest-pack.cjs                                                   # payload ต้นทาง
node dev/selftest-pack.cjs --payload build/Freebuff-Thai-Pack/payload/fbth    # ตัวที่จะส่งจริง
```

ตัวทดสอบสร้าง "แอพปลอม" (app.asar ขนาดจิ๋ว + ui/index.html) ไว้ที่ `dev/.selftest/`
แล้วเรียก fbth กับแอพปลอมเท่านั้น → **ไม่แตะแอพที่ติดตั้งจริงเลย** (ตรวจด้วยการแฮชไฟล์แอพจริงก่อน/หลัง)
ตรวจ 53 ข้อ: ติดตั้งครบทั้ง UI + shell · ติดตั้งซ้ำไม่แก้อะไร · status/ensure · `--dry-run` ต้องไม่เขียนอะไร ·
ช่องแทรกสั้นเกินไปต้องล้มเหลวอย่างสุภาพ · ถอดแล้ว `index.html` + `app.asar` กลับไป **เป๊ะทุกไบต์** ·
และตัวเรียก .cmd ของ pack + `FBTH_APP` ต้องจำกัดอยู่โฟลเดอร์เดียว

### บั๊กที่เจอจากการทดสอบรอบนี้ (แก้แล้ว)

| อาการ | สาเหตุ | แก้ที่ |
|---|---|---|
| `ensure` รายงานผิด/ไม่ตรวจโฟลเดอร์ที่ระบุด้วย `--app` (คืน 0 แล้วไม่ติดตั้ง) | `cmdEnsure` ใช้ `findInstalls()` มองข้าม `--app` | `fbth/fbth.js` → ใช้ `selectInstalls(opts)` + เตือนเมื่อไม่พบที่ติดตั้ง |
| `FBTH_APP=X ติดตั้งภาษาไทย.cmd` ไปติดตั้งแอพอื่นด้วย | `run-fbth.cmd` ใช้ FBTH_APP แค่หาตัวรัน ไม่ส่ง `--app` | `fbth/tools/build-pack.js` (RUN_SCRIPT) |
| ปุ่มติดตั้งของ pack ไม่ทำอะไร (fbth ขึ้น help) | วาง `--app` หน้า `install` → fbth เห็น `--app` เป็นคำสั่ง | RUN_SCRIPT: `%*` ก่อน `%APPARG%` |
| `--dry-run` สร้างโฟลเดอร์ `resources/fbth` เปล่า | `mkdirSync` อยู่นอกเงื่อนไข dryRun | `writeShellAssets()` |

## 8. งานที่ยังเหลือ (เรียงตามความคุ้มค่า)

0. **ข้อความ error ของ API อีก ~89 ข้อความ** ที่ orchestrator ส่งขึ้น toast (`json3({ error: "..." })`)
   — เครื่องมือ `extract-orchestrator-strings.js` ตอนนี้เก็บเฉพาะกลุ่มสกิล (คัดรายการไว้ใน `SKILL_ERROR_TEXTS`)
   ถ้าจะขยาย ให้เพิ่มรายการคัดเลือกหรือทำโหมดสแกนเฉพาะ "ข้อความ error ของ API" แยกต่างหาก (อย่ากวาดทั้งไฟล์ — จะได้ข้อความภายในไลบรารีเกิน 600 คำ)
1. **คำที่สร้างจากเทมเพลตในโค้ด** (เช่น "1 provider connected") — เก็บได้จาก `fbth.panel()` ในแอพจริง
   แล้วเพิ่มเป็น `patterns` (ตัวเก็บในตัวแอพทำงานนี้อยู่แล้ว)
2. **หน้าต่าง consent ของ MCP** (`electron/consent-window.html`) — ข้อความส่วนใหญ่อยู่ในพจนานุกรมแล้ว
   แต่ควรเปิด consent window จริงแล้วไล่ดูว่าเหลือคำใด (ใช้ `fbth.panel()` ไม่ได้เพราะเป็นหน้าต่าง file://)
3. ~~**ขยายพจนานุกรมจาก candidates.json**~~ ✅ ทำแล้ว: ครบทั้ง 5 ไฟล์ candidates (0 คำค้าง) — ที่ยังเหลือคือ *ทบทวน*
   กฎใน `ignore.json` เป็นครั้งคราว เพราะกฎแบบกว้าง (คำเดี่ยว CamelCase / โค้ด CSS) อาจปิดบังป้าย UI ใหม่ได้
4. ~~**ทดสอบอัตโนมัติ**~~ ✅ ทำแล้วบางส่วน: `dev/selftest-pack.cjs` (ติดตั้ง/ถอด ครบวงจร) — ที่ยังเหลือคือ
   สคริปต์ที่รัน `check-dict --strict` + ตรวจ `shell.log` ว่ามีบรรทัดอังกฤษตกค้างไหม แล้วสรุปเป็นรายงานเดียว
5. ~~**ตัวเรียกแอพสำหรับ clone**~~ ✅ แก้ด้วย `FBTH_APP=<clone> เปิด Freebuff ไทย.cmd` (ใช้ได้กับ pack v2)
   — ถ้าอยากได้ไฟล์ `.cmd` แยกต่อ clone จริง ๆ เพิ่มได้ใน `build-pack.js` (pack v3 ขึ้นไปใช้กลไกนี้)

   **_รอบ 4:_** ทูลทิป/คำอธิบายสกิล ✅ ครบแล้ว (42 ข้อความ) · ข้อความสกิลที่เหลือจะโผล่เฉพาะเมื่อแอพเพิ่มสกิลใหม่
   — รัน `node fbth/tools/extract-orchestrator-strings.js` เทียบกับ `check-dict.js` จะเห็นเอง
6. ~~**คำที่เหลือ 157 คำจาก `gap-report`**~~ ✅ ปิดครบแล้ว (รวม 133 pattern และอีก 171 ประโยคที่เจอในสแกนดิบ)
   — รายการที่ "ไม่แปลโดยเจตนา" อยู่ที่ `fbth/dict/ignore.json` พร้อมเหตุผลรายข้อ
7. **ทดสอบกับแอพจริงรอบสุดท้าย**: เปิดแอพ กด `F12` → `fbth.panel()` เพื่อดักข้อความที่ยังเป็นอังกฤษ
   (ตัวเก็บในแอพจะเห็นข้อความที่ขึ้นจอจริง ซึ่งต่างจากสแกนดิกที่เห็นทุกสตริงในโค้ด)

## 9. กับดักที่ต้องระวัง

_รอบ 4 (สกิล/ทูลทิป)_

- **ทูลทิปของชิปในแท็บสกิลไม่มีอยู่ในบันเดิล UI** — UI ประกอบเองจากข้อมูลของ orchestrator:
  ใช้ `description` ถ้ามี ไม่งั้นเอาย่อหน้าแรกของ prompt ต่อกันแล้วตัดที่ 220 ตัวอักษร (ดู `extract-orchestrator-strings.js`)
  ถ้าไม่คำนวณแบบเดียวกัน คีย์จะไม่ตรงและข้อความจะไม่ถูกแปล (และหาสาเหตุยาก)
- **pattern ที่ `from === to` หรือมีแต่ตัวแปรล้วน** (เช่น `{n} {n2}{n3}`) จะกวาดเกือบทุกข้อความแล้วคืนค่าเดิม
  → บังการแปลแบบ pattern ฝังกลางข้อความทั้งระบบ (เจอจริง: "3 files · 12 changes" ไม่ถูกแปล) — ตอนนี้ check-dict ตรวจจับไว้แล้ว
- **ข้อความที่แอพต่อหลายส่วน** (เช่น `<คำอธิบายสกิล>  Edit skill`) — ตัวแปลแยกที่ตัวคั่น `"  "` / `"\n\n"`
  แล้วต้องแปลได้ครบทุกส่วน จึงจะใช้ผล ไม่งั้นปล่อยเป็นอังกฤษเดิม (กันข้อความครึ่งไทยครึ่งอังกฤษ)
- **อย่าใช้ `String.replace(str, str)` สร้างไฟล์ที่มีโค้ด JS** — `$&`, `$'`, `` $` `` ในเนื้อหาจะถูกตีความเป็นรูปแบบพิเศษ
  (ทำไฟล์ bench-inline.html พังเงียบ ๆ หนึ่งรอบ) ให้ส่ง replacer เป็นฟังก์ชัน: `html.replace(a, () => text)`
- **`fbth/dict/th-skills.json` เก็บเฉพาะคีย์ที่คัดลอกจากเครื่องมือ** — ถ้าจะเพิ่ม/แก้คำอธิบายสกิล ให้รัน
  `extract-orchestrator-strings.js --list` แล้วคัดลอกคีย์ทั้งก้อน อย่าพิมพ์เอง

- **อักขระพิเศษ**: คีย์ต้องเป็น `’` `“` `”` `…` ตามต้นฉบับ (โปรแกรมตรวจจะบอกถ้าไม่ตรง)
- **ไฟล์นี้มี BOM/CRLF ในบางที่** (เช่น `index.html` ของ clone B ที่ถูกแก้ด้วย PowerShell มาก่อน → มี BOM และ mojibake `couldnâ€™t`)
  เวลาแก้ไฟล์ในแอพให้เขียนเป็น UTF-8 **ไม่ใส่ BOM** และอย่าแปลง CRLF เป็น LF ทั้งไฟล์ (patcher ของเราแทรกเป็น substring จึงปลอดภัย)
- **แอพที่รันอยู่**: แก้ไฟล์ได้ แต่ต้อง reload (Ctrl+R) หรือปิด-เปิดใหม่จึงเห็นผล
- **อย่าเชื่อ `grep -c`** บน bundle (ไฟล์บรรทัดเดียว) — ใช้ `check-dict.js`/`extract-strings.js` ที่อ่านเป็น string
- **pattern ที่ผิดรูปแบบ** ทำให้ข้อความทั้งก้อนไม่ถูกแปล → `check-dict.js` ตรวจให้แล้ว ("pattern ที่ผิดรูปแบบ: 0")
- **คำสั่งที่รับ `--app` ทุกตัวต้องเรียก `selectInstalls(opts)` ไม่ใช่ `findInstalls()`** ไม่งั้นโหมด `--app`
  จะไปแตะแอพอื่นบนเครื่อง (เคสนี้เกิดกับ `cmdEnsure` แล้ว — หาสาเหตุยากมากถ้าไม่มีตัวทดสอบแซนด์บ็อกซ์)
- **ตัวเรียก `.cmd` ของ pack**: อาร์กิวเมนต์แรกของ fbth ต้องเป็น "คำสั่ง" (`install`/`status`/...) เสมอ
  `--app` วางไว้ท้ายสุด ถ้าวางหน้า คำสั่งจะไม่ทำงานและ fbth จะขึ้น help (exit 0) — ดูอาการคล้าย "ไม่ทำอะไรเลย"
- **เวลาเขียนตัวทดสอบเอง อย่าเปรียบเทียบกับค่าที่แคชไว้**: เก็บแฮช "ก่อน" ได้ แต่ต้องอ่านไฟล์จริงทุกครั้ง
  (รอบนี้พลาดมาแล้ว: `snapshot()` คืนค่าเดิม → เทสต์ผ่านทั้งที่ยังไม่ติดตั้ง)
- **mojibake จากสำเนา/clone**: ข้อความใน `resources/app` ของ clone อาจเป็น UTF-8 → Latin-1 (`â€¦` แทน `…`)
  — เครื่องมือทุกตัว (`check-dict`, `gap-report`, `dict-tools`, `extract-*`) เรียก `fixEncoding()` จาก
  `fbth/tools/gap-report.js` แล้ว **อย่าลบการเรียกนั้นออก** ไม่งั้นจะเจอ "คำตาย" ปลอม ๆ ทั้งที่พจนานุกรมถูก
- **`ignore.json` มีผลเฉพาะการนับช่องว่าง** (gap-report/check-dict/dict-tools) — ไม่มีผลกับการแปลตอนรัน
  ถ้าอยากรู้ว่าหน้าจอจริงยังเหลืออะไร ให้ใช้ `fbth.panel()` ในแอพ ซึ่งไม่ขึ้นกับกฎเหล่านี้
- **หลังเพิ่มคำแปลใหม่ทุกครั้ง** ต้องรัน `node fbth/tools/check-dict.js` — ถ้าเจอ "คีย์ที่ไม่พบบันเดิล" (เช่นพิมพ์
  ตัวพิมพ์ใหญ่ผิด: `Property missing ':'` vs `property missing ':'`) ให้ลบ/แก้คีย์นั้นทันที
- **อย่าเช็ค substring ของชื่อแอพ**: โฟลเดอร์โปรเจกต์นี้ชื่อ "Freebuff AI" ซึ่งมีคำว่า `Freebuff A`
  ตรงกับชื่อ clone → ให้เช็ค `Freebuff-Clones` / `@codebufffreebuff-desktop` แทน
