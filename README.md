# Freebuff AI TH & Freebuff Manager

เครื่องมือภาษาไทยและแอปจัดการ Freebuff Desktop สำหรับ Windows 10–11

## ส่วนประกอบ

- `manager-app/` — Freebuff Manager (Electron)
- `fbth/` — Runtime, พจนานุกรม และตัวติดตั้งภาษาไทย
- `clone-engine/` — ระบบสร้างและอัปเดตแอปโคลนแบบแยกบัญชี
- `dev/selftest-pack.cjs` — ทดสอบติดตั้ง/ถอดใน sandbox 53 ข้อ

อ่านคู่มือภาษาไทยที่ [README-TH.md](README-TH.md) และรายละเอียดสถาปัตยกรรมที่ [HANDOFF.md](HANDOFF.md)

## Build Freebuff Manager

```powershell
cd manager-app
npm ci
npm run build
```

ผลลัพธ์อยู่ใน `manager-app/dist/` ทั้ง Setup และ Portable

## Release

GitHub Actions จะสร้าง Manager และ Thai Pack เมื่อ push tag รูปแบบ:

```powershell
git tag manager-v0.2.0
git push origin manager-v0.2.0
```

Freebuff Manager ตรวจอัปเดตสองช่องทางแยกกันจาก GitHub Release เดียวกัน:

- Mod ภาษาไทย
- Freebuff Manager

ไฟล์ที่ดาวน์โหลดต้องมี SHA-256 digest ตรงกับ GitHub Release ก่อนจึงจะติดตั้งได้
