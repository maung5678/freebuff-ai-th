# AGENTS.md — คำสั่งสำหรับ AI ที่มาทำงานต่อ (Freebuff AI TH)

โปรเจกต์นี้แปล **ตัวโปรแกรม Freebuff Desktop** (แอพ Electron ที่ติดตั้งอยู่ในเครื่อง) ให้เป็นภาษาไทย
โดย**ไม่แก้โค้ดภายใน bundle ของแอพ** ใช้วิธี "พจนานุกรม + ตัวแปลตอนรัน" แทน

> อ่าน `HANDOFF.md` สำหรับสถาปัตยกรรมและสถานะโดยละเอียด · อ่าน `README-TH.md` สำหรับคู่มือผู้ใช้

## Guardrails (ห้ามละเมิด)

1. **ห้ามแก้ไฟล์ใน `resources/orchestrator/ui/assets/*.js` ของแอพ** (bundle ของ React)
   การแก้ JS ที่เขาย่อมาแล้วจะพังเงียบ ๆ และหายทุกครั้งที่แอพอัปเดต ให้เพิ่มคำในพจนานุกรมเท่านั้น
2. **การแก้ `app.asar` ทำได้เฉพาะผ่าน `fbth install-shell`** (เขียนแบบคงความยาวไบต์เท่านั้น +
   ตรวจ syntax ด้วย `vm.Script` ก่อนเขียน) ห้ามแก้มือด้วยเครื่องมืออื่น
   และห้ามแตก `app.asar` เป็น `resources/app` แทนตัว asar (จะทำให้หลังอัปเดตแอพรันโค้ดเก่า)
3. **ไฟล์ที่อนุญาตให้แตะคือ** `<install>/resources/orchestrator/ui/` เท่านั้น:
   `index.html`, `fbth-th.js`, `fbth-dict.json`, `index.html.fbth-original`, `index.html.fbth-state.json`
4. ทุกครั้งที่แก้พจนานุกรม ต้องรัน `node "Freebuff Thai/tools/check-dict.js"` ให้ได้ "คีย์ที่ไม่พบบันเดิล: 0"
   (คีย์ที่ไม่มีในบันเดิล = คำตายเพิ่มขยะให้คนอื่น) ถ้ามีคำตาย ให้รัน `dict-tools.js prune --write`
5. ห้ามเขียนทับ `index.html.fbth-original` — เป็นสำเนาต้นฉบับสำหรับถอดการแปล
6. หลังแก้อะไรใน `Freebuff Thai/` ให้รัน `node "Freebuff Thai/fbth.js" install` เพื่อซิงค์ลงแอพทุกตัว แล้ว `node "Freebuff Thai/fbth.js" status` ต้องขึ้น
   "ตรงกับต้นทาง" ทุกบรรทัด
7. **ก่อนบอกว่างานเสร็จ ต้องรัน `node dev/selftest-pack.cjs` ให้ผ่านทั้ง 53 ข้อ** (และหลัง `build-pack.js`
   ต้องรันซ้ำด้วย `--payload build/Freebuff-Thai-Pack/payload/fbth`) (ทดสอบในแซนด์บ็อกซ์ ไม่แตะแอพจริง)
   ถ้าแก้ `"Freebuff Thai/tools/build-pack.js"` หรือตัวเรียก `.cmd` ต้องเพิ่ม `--payload build/Freebuff-Thai-Pack/payload/fbth` ด้วย
   และต้องไม่แตะแอพที่ติดตั้งจริง (ตัวทดสอบตรวจให้ด้วยการแฮชไฟล์ก่อน/หลัง)
8. งานที่ต้องตรวจกับ *แอพจริง* ให้ทดสอบผ่านสำเนา/clone ก่อนเสมอ: `FBTH_APP=<clone> ...` หรือ `--app <clone>`
   (ห้ามทดลอง `uninstall` กับตัวติดตั้งหลักโดยไม่มีเหตุผล — พจนานุกรม/
   state ในเครื่องผู้ใช้อาจถูกเขียนทับ)

## ลำดับงานมาตรฐาน

| งาน | คำสั่ง |
|---|---|
| ติดตั้ง/ซิงค์การแปลลงแอพทุกตัว (UI + เมนู native) | `node "Freebuff Thai/fbth.js" install` |
| เฉพาะเมนู native / dialog | `node "Freebuff Thai/fbth.js" install-shell` |
| ดู log ของเมนูที่แปลแล้ว (ยืนยันว่าเป็นไทยจริง) | `node "Freebuff Thai/fbth.js" shell-log` |
| ดึงข้อความใหม่ของ shell (หลังอัปเดตแอพ) | `node "Freebuff Thai/tools/extract-shell-strings.js" --auto --json "Freebuff Thai/dict/candidates-shell.json"` |
| ตรวจสถานะ / ตรวจว่าแอพอัปเดตแล้วหรือยัง | `node "Freebuff Thai/fbth.js" status` |
| ตรวจพจนานุกรมกับบันเดิลจริง | `node "Freebuff Thai/tools/check-dict.js"` |
| ดึงทูลทิปสกิล/ข้อความ error ที่มาจาก orchestrator | `node "Freebuff Thai/tools/extract-orchestrator-strings.js" --json "Freebuff Thai/dict/candidates-orchestrator.json"` |
| ดูข้อความกลุ่มนั้นทั้งหมด (คีย์ต้องคัดลอกจากที่นี่) | `node "Freebuff Thai/tools/extract-orchestrator-strings.js" --list` |
| ประกอบ "ชุดติดตั้งภาษาไทย" ส่งต่อให้เครื่องอื่น (+ .zip) | `node "Freebuff Thai/tools/build-pack.js"` |
| ทดสอบติดตั้ง/ถอด ครบวงจรในแซนด์บ็อกซ์ (ไม่แตะแอพจริง) | `node dev/selftest-pack.cjs` |
| ทดสอบ payload ที่จะส่งจริงในชุดติดตั้ง | `node dev/selftest-pack.cjs --payload build/Freebuff-Thai-Pack/payload/fbth` |
| ดูว่าพจนานุกรมยังขาดคำอะไร (เทียบข้อความที่สแกนได้) | `node "Freebuff Thai/tools/gap-report.js" "Freebuff Thai/dict/candidates-ui-objects.json"` |
| ตรวจทุกไฟล์ candidates (รวมสแกนดิบ) | `node "Freebuff Thai/tools/gap-report.js" "Freebuff Thai/dict/candidates.json"` |
| ดึงรายการที่ยังไม่แปลเป็น JSON ไว้ทำงานต่อ | `node "Freebuff Thai/tools/check-dict.js" --todo-json "Freebuff Thai/dict/gap-todo.json"` |
| หลังแอพอัปเดต: ดึงข้อความ UI ใหม่ | `node "Freebuff Thai/tools/extract-strings.js" --jsx --auto --json "Freebuff Thai/dict/candidates-jsx.json"` |
| ดูรายการคำที่ยังไม่แปล | `node "Freebuff Thai/tools/dict-tools.js" todo --write` → เปิด `"Freebuff Thai/dict/TODO.md"` |
| ลบคำที่หายไปหลังอัปเดต | `node "Freebuff Thai/tools/dict-tools.js" prune --write` |
| ทดสอบตัวแปลแบบเห็นภาพ | `node "Freebuff Thai/fbth.js" bench` แล้ว `node dev/serve.js` → http://127.0.0.1:8791/ |
| ถอดการแปลออกทั้งหมด | `node "Freebuff Thai/fbth.js" uninstall` |
| ถอดเฉพาะเมนู native | `node "Freebuff Thai/fbth.js" uninstall-shell` |

## กับดักที่เจอมาแล้ว (อย่าลืม)

- **ทูลทิปของชิปในแท็บสกิลไม่ได้อยู่ในบันเดิล UI เลย** — UI ประกอบข้อความเองจากข้อมูลที่ orchestrator ส่งมา
  (`description` ถ้ามี ไม่งั้นเอาย่อหน้าแรกของ prompt มาต่อกันแล้วตัดที่ช่องว่างสุดท้ายก่อน **220** ตัวอักษร)
  สแกนด้วย `extract-orchestrator-strings.js` เท่านั้น (ข้อความยาวที่ได้จากการ "ประกอบ" นี้จะไม่ปรากฏในซอร์สตรง ๆ)
  ถ้าไม่รู้กลไกนี้ จะเข้าใจผิดว่าคีย์เป็น "คำตาย" แล้วลบทิ้ง — check-dict/dict-tools เรียกเครื่องมือนี้แล้ว
  (`ชิปสกิล N ตัวอักษร` ในผลลัพธ์ check-dict คือความยาวสูงสุดที่อ่านได้จากบันเดิล UI)
- **ห้ามใส่ pattern ที่ `from === to` หรือมีแต่ตัวแปรล้วน** (เช่น `{n} {n2}{n3}`) — มันจะแมตช์ข้อความเกือบทุกอย่าง
  แล้วคืนค่าเดิม → **บังการแปลแบบ pattern ฝังกลางข้อความทั้งระบบ** (เคสจริง: "3 files · 12 changes" ไม่ถูกแปล)
  `check-dict.js` ตรวจสองแบบนี้และขึ้นที่ "pattern ที่ผิดรูปแบบ" แล้ว; ตัวสแกนอาจสร้าง pattern หลอกนี้ขึ้นมาใหม่
  (gap-report กรองออกไม่นับเป็นงานที่ต้องแปล)
- **ข้อความที่แอพต่อจากหลายส่วน** (เช่น `<คำอธิบายสกิล>  Edit skill`) ตัวแปลจะแยกที่ตัวคั่น `"  "` หรือ `"\n\n"`
  แล้วแปลทีละส่วน — และต้องแปลได้ครบทุกส่วน ไม่งั้นปล่อยเป็นอังกฤษเดิม (กันข้อความครึ่งไทยครึ่งอังกฤษ)
- **ทูลทิปหลายอันอยู่ใน attribute `data-tooltip`** (ตัวทูลทิปเป็นก้อน DOM แยกที่แอพสร้างตอน hover) → runtime แปลทั้ง attribute
  และ text node ถ้าเพิ่มทูลทิปใหม่แล้วไม่ขึ้นไทย ให้เช็คว่าข้อความอยู่ใน `data-tooltip` ไหม
- **`%` กับ escape ของ `$` ในสคริปต์แปลงไฟล์**: เวลาสร้างไฟล์ HTML ด้วย `String.replace()` แล้วเอาโค้ด JS ไปแทรก
  ต้องส่งเป็น **ฟังก์ชัน** (`replace(a, () => text)`) ไม่งั้น `$&` / `$'` ในโค้ดจะถูกตีความเป็นรูปแบบพิเศษ ทำไฟล์พังเงียบ ๆ

- **`app.asar` ชนะ `resources/app`** ใน Electron รุ่นนี้ (พิสูจน์ด้วยการทดลอง) → ต้อง patch ที่ asar
  (สคริปต์ clone ของเดิมจึงต้อง `asar pack` กลับ)
- **`NODE_OPTIONS=--require=...` ใช้ไม่ได้** แม้ fuse `EnableNodeOptionsEnvironmentVariable` จะเปิด
  (Electron กรองออปชันที่โหลดโค้ดออก) → อย่าเสียเวลาลองวิธีนี้
- **fuses ปัจจุบัน**: asar integrity = off (แก้ asar ได้), OnlyLoadAppFromAsar = off → ตรวจซ้ำได้ด้วย
  `node "Freebuff Thai/tools/read-fuses.js"`
- **สำเนา (clone) มี mojibake**: สคริปต์ PowerShell อ่าน/เขียนไฟล์เป็น UTF-8 → Latin-1 ทำให้ `…` กลายเป็น `â€¦`
  ตัวแปลมี `fixEncoding()` จัดการแล้ว — ถ้าเพิ่มคีย์ที่มีอักขระ `… ’ “ ” – —` ต้องทดสอบกับ clone ด้วย

## การปิดงานคำแปลให้สะอาด (ใช้ประจำ)

หลังเพิ่ม/แก้คำแปล ต้องเห็นตัวเลขเหล่านี้:

```
node "Freebuff Thai/tools/check-dict.js"      # คีย์ที่ไม่พบบันเดิล: 0 · pattern ที่ผิดรูปแบบ: 0 · ยังไม่แปล: 0
                                   # ข้อความ UI ของ orchestrator (สกิล): 42 คำ · ยังไม่แปล: 0 · pattern 3 · ยังไม่มีคำแปล: 0
node "Freebuff Thai/tools/gap-report.js" "Freebuff Thai/dict/candidates-ui-objects.json"   # ยังไม่มีคำแปล: 0 (ข้อความที่ตรวจยืนยันว่าเป็น UI)
node "Freebuff Thai/tools/gap-report.js" "Freebuff Thai/dict/candidates-orchestrator.json"   # ยังไม่มีคำแปล: 0
node "Freebuff Thai/tools/dict-tools.js" prune     # ต้องขึ้น "ตัดออก 0" (ถ้าไม่ 0 ให้ตรวจก่อน อย่าเพิ่ง --write)
node "Freebuff Thai/tools/gap-report.js" "Freebuff Thai/dict/candidates.json"   # raw scan ใช้เป็นรายการคัดกรอง; ตรวจยืนยันก่อนแปลเพราะรวมข้อความในโค้ด/ภายในด้วย
node "Freebuff Thai/fbth.js" bench                 # แล้วเปิด dev/bench-inline.html ต้องผ่าน 31/31
```

คำที่ไม่ควรแปล (ชื่อแบรนด์/โมเดล/ภาษา/ชนิดข้อมูล/ข้อความภายในไลบรารี/โค้ด CSS) **ห้ามทิ้งค้าง**
ให้เพิ่มกฎใน `"Freebuff Thai/dict/ignore.json"` พร้อม `reason` เสมอ เพื่อให้ตัวเลข "งานที่เหลือ" ของทุกเครื่องมือตรงกัน

หมายเหตุ: เครื่องมือต้องเรียก `fixEncoding()` (จาก `"Freebuff Thai/tools/gap-report.js"`) กับข้อความที่อ่านจากไฟล์
ของ clone เสมอ ไม่งั้น mojibake (`â€¦`) จะถูกนับเป็นคำที่ยังไม่แปลทั้งที่พจนานุกรมมีแล้ว

## กฎการเขียนโค้ดที่พลาดมาแล้ว

- คำสั่งที่รับ `--app` ทุกตัวต้องใช้ `selectInstalls(opts)` ไม่ใช่ `findInstalls()` (เคยพลาดที่ `cmdEnsure`)
- ตัวเรียก `.cmd` ส่งอาร์กิวเมนต์เป็น `fbth.js <คำสั่ง> [args] [--app path]` — คำสั่งต้องมาก่อน `--app` เสมอ
- ข้อความกลุ่มใหม่ให้วางเป็นไฟล์ `Freebuff Thai/dict/th-<หัวข้อ>.json` เสมอ (ตอนนี้มี `th-skills.json` สำหรับสกิล)
- ตัวทดสอบต้องอ่านไฟล์จริงทุกครั้งที่เทียบ (อย่าเปรียบเทียบกับแฮชที่แคชไว้)

## รูปแบบการเพิ่มคำแปล

วางคำใหม่ในไฟล์ใหม่ `Freebuff Thai/dict/th-<หัวข้อ>.json` (patcher merge ให้อัตโนมัติตามชื่อไฟล์):

```json
{
  "strings": { "English UI text": "ข้อความไทย" },
  "patterns": [{ "from": "{n:num} files", "to": "{n} ไฟล์" }],
  "phrases": { "Learn more": "ดูเพิ่มเติม" }
}
```

- `strings` = ตรงทั้งก้อน (ข้อความของ text node หลังตัดช่องว่างหัว-ท้าย)
- `patterns` = ข้อความที่มีค่าตัวแปร ใช้ `{ชื่อ}`, `{ชื่อ:num}` (ตัวเลข), `{ชื่อ:word}` (คำเดียว)
- `phrases` = แทนที่กลางข้อความแบบจับเป็นคำ (ใส่เท่าที่จำเป็น)
- คีย์ต้องคัดลอกมาจากบันเดิลจริงเสมอ (มีอักขระ `’` `“` `”` `…` ให้คัดลอกทั้งตัว อย่าพิมพ์ใหม่)
