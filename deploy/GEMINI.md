# ผู้ช่วยจัด Playlist ผ่าน Gemini

การเชื่อมนี้เรียก Google Gemini API จาก backend ของ STEMORA เท่านั้น หน้าเว็บรับสถานะพร้อมใช้และผลจัดเซ็ต ไม่มี key หรือชื่อโมเดลใน response สำหรับผู้ใช้

## การตั้งค่า

ตั้งค่าฝั่งเซิร์ฟเวอร์ใน `.env` ที่ chmod 600:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=<set privately on the server>
GEMINI_MODEL=gemini-3.8-flash
GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite
GEMINI_CALLS_PER_15_MIN=100
```

Key ต้องมีสิทธิ์เรียก Generative Language API และเข้าถึงโมเดลที่ระบุ เมื่อใช้ key เดียวกับ DJ AS ค่าใช้จ่ายและโควตาของ Google project นั้นใช้ร่วมกัน
อย่าใส่ key ลง frontend, source archive, Git, URL, screenshot หรือ log ห้ามสั่งพิมพ์ Compose config/runtime environment โดยไม่มีการกรองค่าลับ

Backend รองรับ `AI_PROVIDER=ollama` สำหรับใช้บริการ self-hosted เดิมด้วย `AI_BASE_URL` / `AI_MODEL`

## ข้อมูลและขอบเขตงาน

Adapter `backend/playlist_ai.py` ส่งเฉพาะข้อความคำสั่งที่ผู้ใช้กรอกและค่าเริ่มต้นเวลา/รูปแบบพลังงาน ผ่าน HTTPS ไปยัง Google โดยใช้ key ใน request header
Schema ที่รับกลับมีเพียง `target_minutes` (1–480) และ `profile` (`build`, `wave`, `steady`, `closing`) ตรวจชนิดข้อมูลและปฏิเสธฟิลด์อื่น รวมถึงรายการเพลงที่โมเดลอาจแต่งขึ้น
ไฟล์เพลง ข้อมูลบัญชี ชื่อเพลง และคลังเพลงไม่ได้ถูกแนบโดย adapter นี้ การวัด BPM/คีย์/พลังงานและเลือกเพลงที่เป็นเจ้าของยังทำในระบบ STEMORA
การวิเคราะห์อารมณ์เพลงจากไฟล์เสียงผ่าน Gemini ยังไม่ได้เชื่อมในรุ่นนี้

## การใช้งานและการสำรอง

- จัด Playlist ได้ 30 คำขอต่อบัญชีต่อ 15 นาที ตาม rate limit เดิม
- Gemini จำกัดรวม 100 งานต่อ 15 นาทีโดยค่าเริ่มต้น จัดเก็บตัวนับในฐานข้อมูล; ปรับได้ด้วย `GEMINI_CALLS_PER_15_MIN` (1–1,000)
- ไม่เกิน 2 งานภาษาในเวลาเดียวกัน; แต่ละโมเดลมี timeout 20 วินาที และ output budget 1,024 tokens
- ใช้โมเดลสำรองเมื่อพบ quota/transient/network error หรือผลไม่ครบ/ผิด schema; authentication/permission errors หยุดการเรียกภายนอกทันที
- เมื่อบริการภาษาไม่สำเร็จ ยังใช้การอ่านคำสั่งพื้นฐานและจัดเพลงจากข้อมูลวัดจริงได้ โดย `assistant_used=false` และไม่อ้างว่า AI อ่านคำสั่งสำเร็จ
- ตรวจสถานะด้วย model metadata ที่ cache 30 วินาที ไม่มีการ generate เพื่อเช็กไฟเขียว
- บันทึกเฉพาะโมเดล สถานะ และจำนวน tokens สำหรับดูแลต้นทุน ไม่มีคำสั่งผู้ใช้หรือ provider error body ใน log

Token budget เป็นเพดานคำตอบของ API ซึ่งอาจรวม reasoning tokens ต้องติดตามยอดจริงใน Google AI Studio ด้วย จำนวนคำขอเป็น cost guard ภายใน STEMORA ไม่ใช่การเพิ่ม quota ของ Google หรือของ DJ AS

## การเผยแพร่

สคริปต์ `scripts/deploy_gemini.py` ใช้เฉพาะ `/var/www/stemora` บน `mydjplus-ticketsplus` / `143.198.204.118`:

1. อ่าน key จากไฟล์ staging ส่วนตัว `.env.gemini-pending` และทดสอบ provider จริงทั้ง primary/fallback ด้วยข้อมูลสังเคราะห์
2. Build เฉพาะ backend สำรอง PostgreSQL/S3 และรอให้งานเสียงว่าง
3. เปลี่ยนค่าที่เกี่ยวข้องใน `.env` และสร้าง backend container ใหม่
4. ตรวจ health, metadata และแปลคำสั่งไทยผ่าน adapter จริง; ลบไฟล์ key staging เมื่อสำเร็จ
5. หาก publish ไม่ผ่าน คืน runtime environment และ image เดิมโดยเก็บข้อมูล/volume ไว้

ผลอยู่ใน `deploy-logs/gemini-20261029/` ซึ่งต้องเก็บเป็นส่วนตัว การสำรอง environment เดิมอาจมี secret ของบริการอื่น

เอกสาร Google: [โมเดล](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [REST API](https://ai.google.dev/api/generate-content), [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [ราคา](https://ai.google.dev/gemini-api/docs/pricing)
