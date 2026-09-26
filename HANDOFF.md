# HANDOFF.md — สถานะและสถาปัตยกรรม (สำหรับ AI/คนที่มาทำงานต่อ)

อัปเดตล่าสุด: 2026-09-26 · แอปที่ตรวจ: Freebuff Desktop v0.0.147 (Electron + Bun orchestrator) · Manager Portable: v0.2.3 · Thai Pack: v6

---

## 1. สรุปงานที่ทำเสร็จแล้ว

| ส่วน | สถานะ |
|---|---|
| แปล UI ทั้งแอพ (renderer) | ✅ พจนานุกรมรวม **1,635 คีย์ + 286 pattern + 9 phrase** |
| ปิดช่องว่างคำที่ยังไม่แปล | ✅ ตรวจ bundle v0.0.147 แล้ว: **0 คีย์ตาย · 0 pattern ผิดรูปแบบ · 0 ข้อความค้าง** |
| แปลเมนู native + dialog (shell) | ✅ 93 คีย์ · ไม่พบคีย์ที่ไม่มีใน shell |
| ติดตั้งลงแอพที่ตรวจพบ | ✅ ตัวหลักและโคลน A–E — UI และเมนูตรงกับต้นทาง |
| ตรวจสอบกับบันเดิลจริง | ✅ `check-dict.js --strict` ผ่านกับ bundle 6 ชุด |
| ทดสอบในแซนด์บ็อกซ์ | ✅ `dev/selftest-pack.cjs` ผ่าน 53/53 ข้อ; payload v5 ตรวจแยกหลัง build |
| สแกน UI ปัจจุบัน | ✅ 779 JSX strings · 941 UI objects · 2,742 raw strings จาก bundle v0.0.147 |
| ช่องว่างจากสแกน UI | ✅ เพิ่มคำแปล 210 คีย์ + 18 pattern; ทุก candidate ปัจจุบันมีคำแปลหรือกฎ ignore |
| รองรับแอพอัปเดต | ✅ patcher idempotent + ตัวเรียกแอพที่ re-patch อัตโนมัติ (ทั้ง UI และ shell) + เครื่องมือดึงคำใหม่ |
| รองรับ AI ตัวอื่นมาทำต่อ | ✅ AGENTS.md + dict แยกไฟล์ + TODO.md + ตัวเก็บคำที่ยังไม่แปลในแอพ + shell.log |
| ชุดติดตั้งส่งต่อให้เครื่องอื่น (Thai Pack) | ✅ `"Freebuff Thai/tools/build-pack.js"` สร้าง v5 จากซอร์สปัจจุบัน — เครื่องปลายทางไม่ต้องมี Node |
| ทดสอบตัวแปลในเบราว์เซอร์ | ✅ bench ปัจจุบันผ่าน 31/31 บน `dev/bench-inline.html` |
| ทูลทิป/คำอธิบายของ **สกิล** (แท็บ “สกิล”) | ✅ แปลครบ 42 ข้อความ: คำอธิบายสกิล 21 ตัว + ทูลทิปของ review/test/commit (ตัดจาก prompt ความยาว 220 ตัวอักษร) + ข้อความ error ของระบบสกิล · แตกใหม่ได้ด้วย `extract-orchestrator-strings.js` |
| ตรวจข้อความที่ผู้ใช้เห็นจาก orchestrator | ✅ `"Freebuff Thai/tools/extract-orchestrator-strings.js"` + `candidates-orchestrator.json` ต่อเข้า check-dict/dict-tools แล้ว (ข้อความกลุ่มนี้ไม่เคยถูกสแกนมาก่อน) |
| คีย์ที่ตัดจากแอปรุ่นเก่า | ✅ ย้าย 250 คีย์ไป `"Freebuff Thai/dict/removed.json"` เพื่อกู้คืนได้ |

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

%LOCALAPPDATA%\Freebuff-Clones\Freebuff A..E\   ← โคลนที่ตรวจพบในเครื่องเมื่อ 26 ก.ย. 2026
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
├─ Freebuff Thai\             ระบบแปล: CLI, runtime, shell, พจนานุกรม, ตัวสแกน และตัวสร้างแพ็ก
├─ clone-engine\              เครื่องมือสร้าง/จัดการโคลน Freebuff
├─ manager-app\               ซอร์ส Freebuff Manager + package-lock; สร้าง `node_modules/` และ `dist/` ใหม่ได้
├─ Freebuff Manager 0.2.3\    ตัวติดตั้งและ Portable ที่สร้างจาก source (26 ก.ย. 2026)
├─ build\                     Thai Pack v6 ที่สร้างจาก source ปัจจุบัน
├─ dev\                       selftest, bench และเครื่องมือพัฒนา; ไฟล์ bench บางตัวสร้างใหม่ได้
├─ .github\                   workflow สร้าง/เผยแพร่ release
├─ _git_publish\              checkout Git สำหรับ release; เก็บไว้เพื่อประวัติและเผยแพร่
├─ .freebuff\                 รหัสประจำโปรเจกต์ของเครื่องมือ Freebuff
├─ Freebuff-TH.cmd             ตัวเรียก Freebuff ภาษาไทย
└─ Freebuff-Manager.cmd        ตัวเรียก Manager Portable
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
2. ตรวจว่าข้อความยังตรงกับพจนานุกรม: `node "Freebuff Thai/tools/check-dict.js"`
   - มี "คีย์ที่ไม่พบบันเดิล" → แอปเปลี่ยนถ้อยคำ: รัน `node "Freebuff Thai/tools/dict-tools.js" prune --write`
3. เก็บคำใหม่: `node "Freebuff Thai/tools/extract-strings.js" --jsx --auto --json "Freebuff Thai/dict/candidates-jsx.json"`
   แล้ว `node "Freebuff Thai/tools/dict-tools.js" todo --write` → แปลจาก `"Freebuff Thai/dict/TODO.md"` เข้าไฟล์ `th-*.json` ใหม่
4. `node "Freebuff Thai/fbth.js" install` → `ctrl+R` ในแอพ หรือปิด-เปิดใหม่
5. อัปเดตชุดที่ส่งให้เพื่อน: `node "Freebuff Thai/tools/build-pack.js"` แล้ว `node dev/selftest-pack.cjs --payload build/Freebuff-Thai-Pack/payload/fbth`

`fbth status` จะเตือนเองว่า "แอพอัปเดตแล้ว (bundle เปลี่ยน)" เมื่อชื่อไฟล์ bundle เปลี่ยนจากที่บันทึกไว้

## 6. ส่วน shell (เมนู native) ทำงานอย่างไร — เฟส 2

`fbth install` ติดตั้งทั้งสองชั้น: UI (ข้อ 4) และ shell

### โครงสร้าง
```
<install>/resources/
  app.asar                 ← โค้ด Electron main (แก้แบบคงความยาวไบต์เท่านั้น)
  app/electron/main.cjs    ← สำเนาที่แตกไว้ (clone) — patch เพิ่มเพื่อทนการ repack ของสคริปต์ clone
  fbth/                    ← โฟลเดอร์ปลายทางที่ตัวติดตั้งสร้างไว้ใน resources
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
`node "Freebuff Thai/fbth.js" shell-log` (หรือเปิดไฟล์ `resources/fbth/shell.log`) จะเห็น menu dump ล่าสุด
บนเครื่องนี้ยืนยันแล้วทั้ง clone (file+asar) และตัวติดตั้งหลัก (asar)

### กว่าจะได้มาซึ่งวิธีนี้ (สิ่งที่ลองแล้วไม่สำเร็จ — อย่าเสียเวลาซ้ำ)
- `NODE_OPTIONS=--require=...` → Electron กรองออปชันที่โหลดโค้ดออก แม้ fuse จะเปิด
- พึ่ง `resources/app` อย่างเดียว → **asar ชนะ** (ทดสอบแล้ว) จึงต้อง patch asar
- ตัวสคริปต์ clone (PowerShell) ทำ mojibake ให้ shell ของ clone → ต้องมี `fixEncoding()`

## 7. ชุดติดตั้งสำหรับเครื่องอื่น (Thai Pack) — เฟส 3

เครื่องปลายทางไม่ต้องมีโปรเจกต์นี้ และไม่ต้องติดตั้ง Node เพิ่ม

```
node "Freebuff Thai/tools/build-pack.js"        # → build/Freebuff-Thai-Pack/ + Freebuff-Thai-Pack-v6.zip
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
| `ensure` รายงานผิด/ไม่ตรวจโฟลเดอร์ที่ระบุด้วย `--app` (คืน 0 แล้วไม่ติดตั้ง) | `cmdEnsure` ใช้ `findInstalls()` มองข้าม `--app` | `"Freebuff Thai/fbth.js"` → ใช้ `selectInstalls(opts)` + เตือนเมื่อไม่พบที่ติดตั้ง |
| `FBTH_APP=X ติดตั้งภาษาไทย.cmd` ไปติดตั้งแอพอื่นด้วย | `run-fbth.cmd` ใช้ FBTH_APP แค่หาตัวรัน ไม่ส่ง `--app` | `"Freebuff Thai/tools/build-pack.js"` (RUN_SCRIPT) |
| ปุ่มติดตั้งของ pack ไม่ทำอะไร (fbth ขึ้น help) | วาง `--app` หน้า `install` → fbth เห็น `--app` เป็นคำสั่ง | RUN_SCRIPT: `%*` ก่อน `%APPARG%` |
| `--dry-run` สร้างโฟลเดอร์ `resources/fbth` เปล่า | `mkdirSync` อยู่นอกเงื่อนไข dryRun | `writeShellAssets()` |

## 8. สถานะช่องว่างและขั้นตอนอัปเดตครั้งถัดไป

ตรวจ bundle ของ Freebuff Desktop v0.0.147 ที่ติดตั้งในเครื่องเมื่อ 26 ก.ย. 2026 แล้ว:

- `check-dict.js --strict`: 0 คีย์ตาย, 0 pattern ผิดรูปแบบ, 0 UI/orchestrator/shell ที่ยังไม่แปล
- candidates ปัจจุบัน: JSX 779 ข้อความ, UI objects 941 ข้อความ, raw scan 2,742 ข้อความ
- เมื่อ Freebuff อัปเดต ให้สแกน candidates ใหม่จาก bundle แล้วทำตามลำดับใน `AGENTS.md`
- คีย์ที่ prune ออกจากพจนานุกรมหลักเก็บไว้ใน `"Freebuff Thai/dict/removed.json"` เพื่อกู้คืนได้

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
- **`"Freebuff Thai/dict/th-skills.json"` เก็บเฉพาะคีย์ที่คัดลอกจากเครื่องมือ** — ถ้าจะเพิ่ม/แก้คำอธิบายสกิล ให้รัน
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
  `"Freebuff Thai/tools/gap-report.js"` แล้ว **อย่าลบการเรียกนั้นออก** ไม่งั้นจะเจอ "คำตาย" ปลอม ๆ ทั้งที่พจนานุกรมถูก
- **`ignore.json` มีผลเฉพาะการนับช่องว่าง** (gap-report/check-dict/dict-tools) — ไม่มีผลกับการแปลตอนรัน
  ถ้าอยากรู้ว่าหน้าจอจริงยังเหลืออะไร ให้ใช้ `fbth.panel()` ในแอพ ซึ่งไม่ขึ้นกับกฎเหล่านี้
- **หลังเพิ่มคำแปลใหม่ทุกครั้ง** ต้องรัน `node "Freebuff Thai/tools/check-dict.js"` — ถ้าเจอ "คีย์ที่ไม่พบบันเดิล" (เช่นพิมพ์
  ตัวพิมพ์ใหญ่ผิด: `Property missing ':'` vs `property missing ':'`) ให้ลบ/แก้คีย์นั้นทันที
- **อย่าเช็ค substring ของชื่อแอพ**: โฟลเดอร์โปรเจกต์นี้ชื่อ "Freebuff AI" ซึ่งมีคำว่า `Freebuff A`
  ตรงกับชื่อ clone → ให้เช็ค `Freebuff-Clones` / `@codebufffreebuff-desktop` แทน
