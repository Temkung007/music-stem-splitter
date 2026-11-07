# STEMORA — your private DJ workspace

คลังเพลงส่วนตัวบนคลาวด์ ผู้ช่วยจัด Playlist สำหรับ DJ และสตูดิโอแยกเสียงในเว็บเดียว รองรับเดสก์ท็อปและมือถือ

## สิ่งที่ทำได้

- สมัครสมาชิก เข้าสู่ระบบ ออกจากระบบ และเปลี่ยนรหัสผ่าน เซสชันเป็น cookie แบบ HttpOnly และยกเลิกได้
- คลังเพลงแยกตามบัญชี อัปโหลดหลายเพลง ค้นหา กรองแนว/BPM ฟังตัวอย่าง ดาวน์โหลด และแก้ข้อมูล/แท็ก
- วิเคราะห์ BPM, คีย์/Camelot, พลังงานและ waveform จากเสียงจริง โดยแก้ผลประมาณได้
- ตรวจไฟล์ซ้ำ โควตาพื้นที่ ถังขยะและการกู้คืนเพลง/เพลย์ลิสต์
- จัดเซ็ตตาม BPM คีย์ พลังงาน ระยะเวลา และแนวเพลง พร้อมอธิบายลำดับที่แนะนำ
- เชื่อมผู้ช่วยภาษา Gemini API หรือ Ollama เพื่ออ่านคำสั่งภาษาไทย/อังกฤษและแปลงเป็นเงื่อนไขจัดเซ็ต
- แก้ชื่อ ลาก/เลื่อนลำดับ เพิ่ม/นำเพลงออก แนะนำเพลงถัดไป/เพลงแทน จดโน้ต ล็อกตำแหน่ง บันทึก ทำสำเนาและกู้คืนเวอร์ชัน
- ส่งออก CSV, M3U8 หรือ ZIP รวมเพลงกับเพลย์ลิสต์ที่ใช้ชื่อไฟล์ตรงกัน (สูงสุด 1 GB ต่อ ZIP)
- เลือกหลายไฟล์ส่งคิว Worker พร้อมจัดการงาน ย้ายลงถังขยะ กู้คืน หรือลบถาวรเพื่อคืนพื้นที่
- แยกเสียงจากไฟล์หรือเพลงในคลัง เล่น stems พร้อมกัน ปรับ 0–150%, mute, solo, seek, loop และดาวน์โหลด WAV/ZIP
- ส่งงานเข้าคิวถาวรให้แอปบน Mac ของผู้ดูแลแยกเสียงและบันทึก Cloud อัตโนมัติ ลูกค้าปิดเว็บแล้วกลับมารับผลได้
- เก็บต้นฉบับและ stems ใน S3 ที่โฮสต์เอง ผ่าน Garage; มี local storage สำหรับพัฒนา

ข้อมูลและไฟล์ต้องผ่านการตรวจเจ้าของทุกครั้ง รวมถึง byte-range playback และการส่งออก ไฟล์ไม่เปิดสาธารณะ

## เริ่มในเครื่อง

ต้องมี Node.js 20.9+, Python 3.12, FFmpeg/ffprobe, [uv](https://docs.astral.sh/uv/) และ Docker สำหรับ S3 ที่โฮสต์เอง

```bash
# สร้างคีย์ส่วนตัวและ S3 บนเครื่องเรา (ทำครั้งแรก)
python3 scripts/setup_storage.py
docker compose -f compose.storage.yml up -d

# ติดตั้งและเปิดสตูดิโอ พร้อม AI แยกเสียง
./run.sh --ai
```

เปิด **http://localhost:3000** แล้วสร้างบัญชี ข้อมูลแยกเป็นส่วนตัวสำหรับทุกบัญชี
หากยังไม่ต้องการติดตั้ง AI แยกเสียง ใช้ `./run.sh` เพลงตัวอย่าง/คลังเพลง/จัดเซ็ต/DSP ยังใช้ได้
หากไม่มี `.env.storage` แอปใช้ local storage ในโฟลเดอร์ข้อมูลแทน

ไม่ต้องรัน `setup_storage.py` ซ้ำเมื่อมีไฟล์อยู่แล้ว เพราะคีย์เดิมใช้เข้าถึงข้อมูลเดิม
ไฟล์ `.env`, `.env.storage`, `deploy/garage.toml` เป็นความลับและถูก ignore จาก Git

### ผู้ช่วยภาษา AI บนเครื่องหรือ VPS

เว็บจริงใช้ Gemini ผ่าน backend โดยเก็บ key ฝั่งเซิร์ฟเวอร์และมีโมเดลสำรอง ดูการตั้งค่าและขอบเขตการส่งข้อมูลใน [deploy/GEMINI.md](deploy/GEMINI.md)

ใช้ Ollama แบบ self-hosted ได้ โดยตั้ง `AI_PROVIDER=ollama`:

```bash
docker compose -f compose.ai.yml up -d
docker compose -f compose.ai.yml exec assistant ollama pull qwen2.5:1.5b
```

เพิ่ม `AI_BASE_URL=http://127.0.0.1:11435` และ `AI_MODEL=qwen2.5:1.5b` ใน `.env.storage` แล้วรีสตาร์ต backend
ถ้ามี Ollama อยู่แล้ว ใช้ endpoint และโมเดลที่ติดตั้งไว้แทนได้ หน้าเว็บไม่แสดงชื่อโมเดล

AI ช่วยอ่านคำสั่งและกำหนดเงื่อนไข ส่วนลำดับเพลงคำนวณจากไฟล์ในคลังของเจ้าของเท่านั้น ไม่มีการแต่งรายชื่อเพลงใหม่
หากไม่ได้เปิดบริการ AI หรือบริการไม่ตอบ ระบบยังจัดจากข้อมูลเสียงและตัวเลือกในฟอร์มได้ โดยข้อความผลลัพธ์จะระบุเฉพาะวิธีที่ทำงานสำเร็จจริง

## ขอบเขตการวิเคราะห์และจัดเซ็ต

- เพลงในคลัง: MP3/WAV/FLAC/M4A/AAC/OGG สูงสุด **100 MB / 30 นาที** ต่อเพลง
- งานแยกเสียง: สูงสุด **50 MB / 10 นาที**; งาน Worker ในบัญชีเดียวกันรอพร้อมกันได้ไม่เกิน 10 งาน
- วิเคราะห์เสียงไม่เกิน 120 วินาทีแรกเพื่อควบคุมทรัพยากร BPM/คีย์/พลังงานเป็นค่าประมาณ โดยเฉพาะเพลงจังหวะเปลี่ยนหรือมีคีย์เปลี่ยน ต้องฟังตรวจสอบ
- คะแนนพลังงานเป็น descriptor สัมพัทธ์ ไม่ใช่การระบุอารมณ์หรือแนวเพลงแบบรับประกัน แนวเพลง/แท็กอ่านจาก metadata หรือผู้ใช้กำหนด
- เวลารวมของ Playlist เป็นความยาวเพลงก่อนซ้อนมิกซ์จริง หากเพลงไม่พอตามเวลาที่ขอ ระบบจะบอกตรง ๆ
- M3U8 ใช้ชื่อไฟล์แบบ relative ให้ดาวน์โหลด ZIP หากต้องการแพ็กที่มีทั้งเพลงกับเพลย์ลิสต์ ไม่มีลิงก์ไฟล์ส่วนตัวถาวรถูกใส่ใน export
- ไม่มีการมิกซ์เสียงอัตโนมัติหรือเขียนฐานข้อมูล proprietary ของโปรแกรม DJ การส่งออกเป็น CSV/M3U8/ZIP มาตรฐาน
- ผลลัพธ์มิกเซอร์เป็นการฟังตัวอย่าง WAV ที่ดาวน์โหลดคือ stems ที่แยกแล้ว ไม่ได้พิมพ์ค่ามิกเซอร์ลงไฟล์
- ถังขยะยังนับพื้นที่ ไม่มีการลบเพลงของผู้ใช้อัตโนมัติ

## VPS / Production

แต่ละบัญชีมีพื้นที่ฟรี 200 MB (200,000,000 bytes) รวมต้นฉบับ แทร็คที่แยกแล้ว และ ZIP ที่เก็บไว้ เพลงในถังขยะยังนับพื้นที่
หากลดโควตาแล้วบัญชีเดิมใช้เกิน จะเก็บข้อมูลไว้และปฏิเสธการเพิ่มไฟล์หรือผลลัพธ์ใหม่ที่เกินโควตา
สลับ TH / EN ได้จากหน้าล็อกอินและพื้นที่ใช้งาน ระบบจำภาษาใน browser รวมเมนู ฟอร์ม ข้อความผิดพลาดและวันที่
ชื่อผู้ใช้ ชื่อเพลง และโน้ตที่กรอกเองคงตามต้นฉบับ

มี Dockerfile, Compose, HTTPS gateway และคู่มือแยกใน [deploy/README.md](deploy/README.md)
ระบบจริงเปิดที่ https://stemora.mydjplus.com ดูข้อมูลเครื่องและคำสั่งดูแลใน [deploy/PRODUCTION.md](deploy/PRODUCTION.md)

```bash
python3 scripts/setup_deploy.py --domain music.example.com
docker compose --profile ai up -d --build
docker compose --profile ai exec assistant ollama pull qwen2.5:1.5b
```

ต้องชี้ DNS มาที่ VPS และเปิดพอร์ต 80/443 ก่อน ใช้ `setup_deploy.py` โดยไม่มี `--domain` สำหรับทดสอบที่ http://localhost:8080

ใช้ backend **1 worker / 1 instance** สำหรับงานวิเคราะห์และแยกเสียงบน VPS ที่ยังอยู่ในโปรเซส ส่วน Operator Worker ใช้คิว PostgreSQL ถาวรและ lease แยกต่างหาก จึงทนต่อการรีสตาร์ต backend ได้ ใช้ PostgreSQL container และ volume เฉพาะ STEMORA ส่วน native development ใช้ SQLite WAL
งาน Operator Worker ที่ขาดการเชื่อมต่อจะเข้าคิวเริ่มแยกใหม่ได้สูงสุด 3 ครั้ง แต่ละเครื่องประมวลผลพร้อมกันได้ 1–4 เพลงตามสเปค และหลายเครื่องรับคนละเพลงพร้อมกันได้ ยังไม่เก็บ checkpoint ระหว่าง inference
ติดตั้งและดูแลแอปรับงานบน Mac ตาม [deploy/WORKER.md](deploy/WORKER.md) รุ่นปัจจุบันใช้ MLX บน GPU ของ Apple silicon พร้อม CPU สำรอง มีโหมดมาตรฐาน/ละเอียด เก็บโมเดลพร้อมใช้ระหว่างเพลง และเก็บผลไว้ส่งต่อเมื่อเน็ตหลุด ต้องเปิดเครื่อง เชื่อมอินเทอร์เน็ตและเปิดฝาไว้ขณะรับงาน ผลทดสอบเสียงสั้นยังไม่ใช่คำรับประกันความเร็วเพลงเต็ม

## ทดสอบ

```bash
uv pip install --python backend/.venv/bin/python -r backend/requirements.txt
backend/.venv/bin/python -m unittest discover -s backend/tests -v

cd frontend
npm ci
npm run lint
npm run build
```

ชุดทดสอบใช้ HTTP/FFmpeg/เสียงจริง ตรวจ auth, CSRF, การแยกสิทธิ์, analysis, duplicate, trash/restore, revisions, locks, ZIP/M3U8 และ range requests
ใช้ `STEMORA_TEST_STORAGE=s3` พร้อมตัวแปร S3 เพื่อทดสอบกับ storage จริง ทดสอบใน namespace ของบัญชีสุ่มและลบเฉพาะ object ทดสอบเมื่อจบ

ผลตรวจระบบและภาพหน้าจออยู่ใน [docs/verification.md](docs/verification.md)

## โครงสร้าง

- `backend/auth.py`, `database.py` — บัญชี session, PostgreSQL และ SQLite สำหรับ native
- `backend/storage.py`, `cloud.py` — private S3/local storage และคลังเพลง
- `backend/audio_analysis.py`, `playlists.py` — วิเคราะห์เสียง จัดเซ็ต และ export
- `backend/main.py` — งานแยกเสียงและ private stem delivery
- `frontend/src/components/` — auth, library, playlists, account และ stem mixer
- `compose.yml`, `deploy/` — ชุด VPS พร้อม gateway และ persistent volumes
- `scripts/` — setup, backup, restore และย้าย object storage

## ซอฟต์แวร์และสิทธิ์

ใช้ Next.js, FastAPI, FFmpeg, librosa, Garage, Ollama และ Demucs สำหรับงานแต่ละส่วน
Demucs code เป็น MIT แต่สิทธิ์ pretrained weights มีข้อจำกัด/ความไม่ชัดเจนตาม [คำอธิบายผู้พัฒนา](https://github.com/adefossez/demucs#license) จึงไม่รับรองการใช้โมเดลเพื่อเปิดบริการเชิงพาณิชย์
Garage เป็น AGPLv3; ควรตรวจสิทธิ์ dependencies และโมเดลที่เลือกก่อนเผยแพร่ระบบ
เพลงตัวอย่างเป็นเสียงสังเคราะห์ที่สร้างจากโค้ดในโปรเจกต์ ไม่มีการดึงเพลงภายนอกเข้าคลัง

## แยกเสียงด้วย GPU ของผู้ใช้

สตูดิโอเริ่มด้วยโหมด WebGPU แยก 2/4 แทร็คในเบราว์เซอร์ เล่นและดาวน์โหลดได้ทันที แล้วเลือกบันทึกเข้า private cloud ภายในโควตา 200 MB ได้เอง ไม่มีการอัปโหลดต้นฉบับอัตโนมัติ อุปกรณ์ที่ไม่รองรับยังเลือกโหมดเซิร์ฟเวอร์ได้ ดูการติดตั้งไฟล์ประมวลผล การ cache ข้อจำกัด และวิธีเผยแพร่ใน [CLIENT-STEMS.md](deploy/CLIENT-STEMS.md)

Worker 1.5.0 รองรับงานพร้อมกันตามสเปคและ fleet หลายเครื่องและ AI แยกเสียงร้องเฉพาะทาง ดู [การเพิ่มเครื่องและคิว](docs/WORKER-FLEET.md) และ [รุ่น AI/ผลทดสอบ](docs/AI-model-review-20261030.md)

การตั้งจำนวนงานพร้อมกัน: [Worker Parallel](docs/WORKER-PARALLEL.md)
