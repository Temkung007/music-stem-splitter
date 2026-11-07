# STEMORA frontend

Next.js / React / TypeScript private DJ workspace. See the [project README](../README.md) for storage, analysis, accounts and deployment.

```bash
npm ci
npm run dev
npm run lint
npm run build
```

The API proxy defaults to `http://127.0.0.1:8000`. Set `BACKEND_URL` before building to change it. Production Docker output is standalone.
Authentication uses HttpOnly cookies; mutation requests go through `apiFetch` to send the CSRF request header. Do not put S3 credentials or model names into client configuration.

WebGPU studio: `npm run dev` และ `npm run build` ตรวจ/ดาวน์โหลด runtime และ weights ที่ pin SHA-256 ไว้ให้อัตโนมัติ (ประมาณ 96 MB) ผลแยกเสียงอยู่ใน dedicated worker และบันทึก cloud เมื่อผู้ใช้เลือกเท่านั้น ดู [รายละเอียด](../deploy/CLIENT-STEMS.md)
