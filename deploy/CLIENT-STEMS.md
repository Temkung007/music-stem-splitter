# การแยกเสียงในเบราว์เซอร์ด้วย WebGPU

โหมดเริ่มต้นของสตูดิโอใช้ GPU ของผู้ใช้ผ่าน dedicated Web Worker บน HTTPS หรือ localhost
ตรวจว่ามี GPU adapter จริงก่อนเปิดปุ่มเริ่ม ไม่ใช้การตรวจชื่อเบราว์เซอร์อย่างเดียว
อุปกรณ์ที่ไม่รองรับเลือกโหมดเซิร์ฟเวอร์เดิมได้เอง ไม่มีการอัปโหลดหรือสลับไปใช้ CPU เซิร์ฟเวอร์โดยอัตโนมัติ

เลือกไฟล์จากเครื่องได้สูงสุด 50 MB / 10 นาที หรือเลือกเพลงจากคลังเพื่อดาวน์โหลดมาแยกในเครื่อง
เบราว์เซอร์ต้องถอดรหัส codec นั้นได้ ใช้ WAV หรือ MP3 เมื่อ codec อื่นเปิดไม่ได้
ประมวลผลที่ 44.1 kHz stereo ได้ผล 4 แทร็ค หรือรวมเสียงดนตรีเป็นโหมด 2 แทร็ค
งานสองโหมดนี้ใช้การคำนวณแยก 4 เสียงเหมือนกัน จึงไม่รับประกันว่าเลือก 2 แทร็คแล้วจะเร็วกว่า

ผลลัพธ์เล่นพร้อมกันในมิกเซอร์เดิม ดาวน์โหลด WAV PCM16 แยกไฟล์หรือ ZIP ได้ในเครื่อง
ผลที่ยังไม่บันทึกจะหายเมื่อปิด/โหลดแท็บใหม่ จึงมีข้อความอธิบายและ beforeunload ป้องกันการปิดโดยไม่ตั้งใจ
ยกเลิกงานด้วยการ terminate worker; เมื่อเสร็จจะเก็บ worker ไว้ใช้ kernel ที่เตรียมแล้วกับเพลงต่อไป และคืน GPU หลังว่าง 5 นาที
Web Locks จำกัดงาน GPU ต่อ origin เพื่อป้องกันหลายแท็บประมวลผลพร้อมกันเมื่อเบราว์เซอร์รองรับ API นี้
ความเร็วและหน่วยความจำขึ้นกับอุปกรณ์ รวมถึงการเตรียม shader ครั้งแรก จึงไม่มีตัวเลขเวลาเสร็จตายตัว

## ไฟล์ประมวลผลและ privacy

ใช้ runtime WASM/WebGPU ที่ build จาก demucs-rs v0.3.5 และน้ำหนัก HTDemucs แบบมาตรฐาน 4 เสียง
ชื่อโมเดลไม่แสดงใน UI; ชื่ออยู่ในเอกสารสำหรับผู้ดูแลและประกาศลิขสิทธิ์
runtime ใช้ build ที่ปิด autotune ของ Burn เพื่อเลี่ยง timestamp-query profiling ที่ทำให้ GPU readback ล้มเหลวในเบราว์เซอร์ โดยยังเปิด WebGPU + fusion; ไม่แก้ชั้นโมเดลหรือน้ำหนักเสียง ดู patch และวิธี build ใน frontend/inference-assets/README.md
worker bridge ของแอปจัดการ cache, checksum, inference และแพ็กเสียง
source commit และ SHA-256 อยู่ใน `frontend/public/client-stems/NOTICE.txt` / `assets.json`
ประกาศ Apache, MIT และ dependency inventory อยู่ใน directory เดียวกัน

ดาวน์โหลดประมาณ 96 MB ครั้งแรก (WASM 12,771,203 bytes + weights 84,030,696 bytes)
model ถูกตรวจ SHA-256 ก่อนใช้และเก็บใน CacheStorage เมื่อพื้นที่อุปกรณ์พอ
หาก cache ถูกล้าง/พื้นที่เต็ม ระบบยังทำงานได้และอาจต้องดาวน์โหลดใหม่
ไฟล์ทั้งหมดเสิร์ฟจาก origin STEMORA เอง ไม่มีการส่งเสียงไป Hugging Face, GitHub หรือ Gemini
Gemini ยังคงทำหน้าที่อ่านคำสั่ง playlist ฝั่ง backend ตามเดิม

ไฟล์ weights และ WASM ที่คลายแล้วไม่อยู่ใน Git; WASM ที่ build แบบปิด autotune แพ็ก gzip 2.6 MB ไว้กับ source การรัน `npm run dev` / `npm run build` ใน frontend จะเรียก
`node scripts/prepare-client-stems.mjs` เพื่อดึงไฟล์จาก URL ที่ pin revision/size/SHA-256 ไว้
Docker build ใช้ขั้นตอนเดียวกัน และคัดลอก public assets เข้า image สำหรับให้เบราว์เซอร์ดาวน์โหลด
ไฟล์ assets ใช้ immutable cache; worker และ helper ใช้ no-cache ที่ origin; entry worker ใช้ชื่อมีเวอร์ชันเพื่อหลีกเลี่ยง cache policy ของ CDN ที่อาจทับ header

## บันทึกผลใน cloud

กด **บันทึกเข้า cloud** เพื่อส่งเฉพาะ WAV ที่แยกแล้วผ่าน `/api/client-stems/uploads`
แบ่งเป็นชิ้นละไม่เกิน 4,000,000 bytes พร้อม offset และ resume/retry แบบ idempotent เพื่อรองรับชุดแทร็ครวมเกิน 100 MB โดยไม่ชน request limit ของ CDN
ตรวจโควตาก่อนสร้าง upload session และตรวจซ้ำแบบ atomic ตอน commit; ระหว่างส่งมีเปอร์เซ็นต์ความคืบหน้า
ไฟล์ชั่วคราวแยกตามบัญชีและ UUID จำกัด 3 session ต่อบัญชี และล้างเมื่อเกิน 2 ชั่วโมง (ตรวจตอนเริ่มแอป/เริ่มอัปโหลด และทุก 10 นาที)
การเริ่มเพลงใหม่ทิ้งเฉพาะ session ชั่วคราวของผลลัพธ์เดิม ไม่มีการลบแทร็คที่บันทึกสำเร็จ
API multipart `/api/client-stems` เดิมยังรับผลลัพธ์ของ client เวอร์ชันก่อนหน้าได้
ตรวจพื้นที่ก่อนอัปโหลด และ backend ตรวจซ้ำโดยล็อกยอดพื้นที่ใน transaction
ต้อง login และผ่าน CSRF guard; จำกัดอัตราคำขอ ตรวจ UUID ชุดชื่อแทร็ค WAV header ขนาด ความยาว และระยะเวลาที่ตรงกัน
ใช้ client UUID ภายในบัญชีเพื่อให้ retry การบันทึกไม่สร้างสำเนาซ้ำ
ผลลัพธ์เป็นงาน `webgpu` ที่เปิดจากคลังงานเดิมได้ และอยู่ใน private S3 ของบัญชี
ไม่เก็บ ZIP ซ้ำใน S3: สร้าง ZIP ชั่วคราวตอนดาวน์โหลดแล้วลบเมื่อส่งเสร็จ โควตาจึงนับเฉพาะ WAV ที่เก็บจริง
หากพื้นที่ไม่พอ ผลลัพธ์ในเครื่องยังเล่นและดาวน์โหลดได้ตามเดิม

STEMORA vhost รับ request สูงสุด 205m เพื่อรองรับแทร็คที่รวมกันไม่เกินโควตาฟรี 200,000,000 bytes พร้อม multipart overhead
ไฟล์เพลงปกติยังตรวจขนาดสูงสุดเดิมใน API ของแต่ละฟังก์ชัน

## ตรวจและเผยแพร่

```bash
node scripts/check-i18n.cjs
node scripts/test-client-stems.mjs
backend/.venv/bin/python -m unittest discover -s backend/tests -v
cd frontend
npm run build
```

สคริปต์ `scripts/deploy_client_stems.py` ใช้เฉพาะ hostname `mydjplus-ticketsplus` / SSH server IP `143.198.204.118`
รับ source staging `/var/www/stemora/incoming-webgpu-20261029` ที่มี `STEMORA_SOURCE.json` พร้อม SHA-256
สำรอง source, image IDs, Nginx และข้อมูลก่อนเปลี่ยนบริการ; ไม่แก้ `.env` หรือ credentials
build/recreate เฉพาะ frontend/backend (หรือ frontend อย่างเดียวด้วย --runtime-fix); --upload-fix ใช้ staging/log ชื่อ webgpu-upload-20261029 และปรับ request size เฉพาะ vhost STEMORA หลังทดสอบ Nginx
ตรวจ origin assets/MIME, auth, quota, Gemini config และ health ของ TicketPlus; ตรวจ HTTPS สาธารณะจากภายนอก VPS เพื่อแยกจาก Cloudflare WAF; หากผิดพลาดจะย้อน image/source/vhost เดิม
บันทึกสถานะอยู่ใน `deploy-logs/webgpu-20261029/`
