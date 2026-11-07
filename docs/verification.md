# ผลตรวจระบบ STEMORA

ตรวจจากโค้ดใน working tree นี้ด้วยเสียงสังเคราะห์และบัญชีทดสอบส่วนตัว ไม่มีการอัปโหลดเพลงจากแหล่งภายนอก

| ส่วน | ผลที่ตรวจแล้ว |
|---|---|
| Frontend | ESLint และ Next.js production build ผ่าน |
| Backend | เดิมทดสอบ HTTP/FFmpeg/Garage S3 20 รายการผ่าน; หลังเพิ่ม PostgreSQL, โควตาและสองภาษา ทดสอบ 28 รายการผ่านกับ PostgreSQL จริง และ 27 รายการผ่านกับ SQLite (ข้ามเฉพาะ migration test ที่ต้องมี PostgreSQL) |
| Gemini regression | เพิ่ม provider tests 9 รายการ: header ที่เก็บ key, schema/ชนิดข้อมูล, thought filtering, fallback เมื่อ 429/timeout/ผลไม่ครบ, หยุดเมื่อ key ใช้ไม่ได้, metadata cache และ local planning เมื่อ provider ไม่พร้อม; ทั้งชุดรัน 37 รายการ ผ่าน 36 และข้าม PostgreSQL migration 1 รายการ หลังปรับ request format ทดสอบ provider 9 รายการผ่านซ้ำ |
| Gemini บน VPS | ใช้ key ของ DJ AS ที่เจ้าของอนุญาต ส่งแบบเข้ารหัสและเก็บใน environment ฝั่ง backend; primary 3.8 Flash อ่านคำสั่งไทย 90 นาที/closing และ fallback 3.5 Flash-Lite อ่านอังกฤษ 45 นาที/steady ผ่านจริง; runtime ใน Docker อ่านไทย 75 นาที/build ผ่าน |
| Gemini ผ่านเว็บจริง | browser สร้างเซ็ตจากคำสั่ง “เจ็ดสิบห้านาที” ได้เป้าหมาย 75 นาที พร้อมข้อความ AI ช่วยอ่านคำสั่ง; HTTPS API อังกฤษ “forty-five minutes” ได้ 45 นาที/steady, `assistant_used=true`, ใช้เฉพาะเพลงของเจ้าของและ ZIP ผ่าน; response ไม่เผย model/key fields และโควตายังคง 200 MB |
| Gemini deployment | build/recreate เฉพาะ backend; phase `ready`; source manifest 92 ไฟล์ตรงครบ; backup `20261029T070522Z` มี 18 objects และ PostgreSQL dump ตรวจสารบัญผ่าน; ล้างไฟล์โอน key ชั่วคราว, `.env` mode 600, DJ AS ต้นทาง online และ TicketPlus HTTPS ตอบ 200 |
| พื้นที่ฟรี | ค่าเริ่มต้นและชุดติดตั้งเป็น 200,000,000 bytes ต่อบัญชี (200 MB แบบ decimal); ทดสอบยอดที่นับ stems ด้วย ปฏิเสธอัปโหลด/ผลลัพธ์ที่เกินโควตา และอีกบัญชีใช้งานต่อได้; เก็บข้อมูลเดิมเมื่อใช้เกินและล้างเฉพาะผลลัพธ์ชั่วคราวของงานที่ไม่สำเร็จ |
| สองภาษา | catalog TH/EN 485 ข้อความตรงกันระหว่าง frontend/backend; ตรวจ placeholders, การเลือกภาษาจาก Accept-Language, การแปลข้อความผิดพลาด และการคงชื่อ/โน้ตผู้ใช้ไว้ |
| โควตาและภาษาบนเว็บจริง | เผยแพร่บน `143.198.204.118` สำเร็จ; บัญชีเดิมแสดง 200.0 MB และเปิดข้อมูลเดิมได้; หน้าเข้าสู่ระบบ/สมัครสมาชิกและคลังเพลงสลับ TH/EN ได้ จำภาษาหลังรีเฟรช; ภาพ `production-quota-th.png`, `production-quota-en.png` และ `production-quota-signup-th.png` |
| Smoke หลังอัปเดตโควตา | HTTPS origin `--audio-ai --language en` ผ่านอัปโหลด/วิเคราะห์, range, Playlist/ZIP, private S3, ผู้ช่วยภาษาและแยก 4 stems; `quota_bytes=200000000`, `language=en`; anonymous API ทั้ง TH/EN ถูกปฏิเสธพร้อมข้อความตามภาษา |
| Backup ก่อนอัปเดตโควตา | ชุด `20261029T055643Z` มี portable snapshot, S3 objects, task manifests และ PostgreSQL dump; ตรวจสารบัญ native dump ผ่าน และ source manifest 88 ไฟล์ตรงครบหลัง deploy |
| ภาษาต่อ request | ทดสอบ HTTP สลับ EN/TH พร้อมกันแล้ว detail และ Content-Language ตรงคำขอแต่ละรายการ ไม่มีข้อความข้ามภาษา |
| ภาษาใน browser | ตรวจคลังเพลง บัญชี Playlist มิกเซอร์ และวันที่; สลับ TH/EN ได้ จำค่าหลัง refresh ร่าง Playlist ยังอยู่เมื่อสลับและย้อนค่ากลับได้; ตรวจหน้าจอมือถือ 390×844 ทั้งสองภาษา |
| PostgreSQL migration | ทดสอบย้ายครบ 7 ตาราง ตรวจ digest ทุกแถว เก็บภาษาไทย/อักขระพิเศษ sessions และค่าเกิน 32-bit; ปฏิเสธฐานที่ไม่ว่าง และ rollback ทั้ง transaction เมื่อข้อมูลบางตารางผิดชนิด |
| PostgreSQL concurrency | ยิงแก้ Playlist เวอร์ชันเดียวกันพร้อมกัน ได้ 200 เพียงรายการเดียวและ 409 สำหรับอีกรายการ; ตรวจ duplicate account ให้ 409 |
| PostgreSQL backup/restore | สร้าง portable SQLite snapshot และ native custom dump จริง กู้ dump ลง DB ทดสอบใหม่แล้วตรวจ digest ตรงครบ 7 ตาราง; ตรวจ application role ว่าไม่เป็น superuser และไม่มีสิทธิ์สร้าง DB/role |
| สมัครและล็อกอินบน VPS | ทดสอบ HTTPS ที่ origin โดยตรวจใบรับรองตามปกติ: anonymous ถูกปฏิเสธ 12 endpoints, สมัครด้วย email/password และชื่อไทยทั่วไปสำเร็จ, บัญชีใหม่เห็นคลังว่างส่วนตัว, ล็อกอินด้วย email/password โดยไม่ต้องส่งชื่อได้ และ logout แล้ว session ใช้งานต่อไม่ได้; cookie เป็น Secure/HttpOnly |
| ความเป็นส่วนตัว | ปฏิเสธ anonymous access และการอ่านเพลง/stems/Playlist/ZIP ข้ามเจ้าของ; ตรวจ CSRF และการยกเลิก session |
| คลังเพลง | อัปโหลด วิเคราะห์ waveform/BPM/key/energy ตรวจซ้ำ แก้ข้อมูล ถังขยะ/กู้คืน และ range playback |
| Playlist | จัดเซ็ต แก้ลำดับ ล็อกเพลง แนะนำเพลงถัดไป/เพลงแทน revisions ประวัติ และ CSV/M3U8/ZIP |
| ผู้ช่วยภาษา | เรียกบริการ self-hosted จริงด้วยคำสั่งภาษาไทย; `assistant_used=true` ใน native และ Docker gateway smoke |
| แยกเสียง AI บน host | แยกเพลงสังเคราะห์ 16 วินาทีจาก private S3 สำเร็จ 4 แทร็ค; อุปกรณ์ MPS ใช้ CPU retry เมื่อพบ operation ที่ไม่รองรับ |
| Smoke พร้อม audio AI | `scripts/smoke.py --url http://localhost:3000 --audio-ai` ผ่านทุกขั้น ตั้งแต่อัปโหลดถึง original/stem range และ ZIP จริง |
| มิกเซอร์ | โหลด stems จริง ฟังพร้อมกัน ปรับระดับ mute/solo seek และ loop ผ่าน Web Audio clock เดียว |
| Docker gateway | Frontend, backend, private Garage และ gateway รันบน Linux ARM; smoke ผ่านบัญชี อัปโหลด วิเคราะห์ byte-range จัดเซ็ต และ ZIP |
| Docker พร้อม audio AI | default image build สำเร็จบน Linux ARM หลังเพิ่ม system Opus ให้ sphn; `--audio-ai` smoke ผ่านทั้ง language assistant จริงและแยก 4 stems ด้วย CPU พร้อมอ่าน WAV/ZIP จาก S3 |
| Backup | snapshot SQLite + S3 objects + task manifests; สำรองจาก Docker container ได้ |
| Restore | กู้ลง directory ใหม่ แล้วตรวจบัญชีเดิม 6 เพลง 1 Playlist และงานแยกเสียง 1 งาน; เปิด original range และ ZIP stems ได้ |
| หน้าจอ | ตรวจผ่าน in-app browser ที่ 1440×1000 และ 390×844 พร้อมภาพจริงใน `docs/screenshots/` |
| ร่างที่ยังไม่บันทึก | ทดสอบแก้ชื่อเซ็ต เปลี่ยนหน้าถูกกันไว้โดยร่างยังอยู่; ย้อนค่าแล้วข้อความหายและเปลี่ยนหน้าได้ มี beforeunload guard สำหรับ refresh/ปิดแท็บด้วย |
| VPS จริง | ติดตั้งบน Ubuntu x86_64 ที่ `143.198.204.118` ใน `/var/www/stemora`; frontend, backend, PostgreSQL, Garage และผู้ช่วยภาษาทำงานครบ โดย backend และ PostgreSQL healthy |
| PostgreSQL บน VPS | `stemora-database-1` ใช้ volume `stemora_database-data` ไม่มี host port; backend เชื่อม DB/role `stemora` ที่ไม่มีสิทธิ์ superuser/create-db/create-role แยกจาก TicketPlus |
| ย้ายข้อมูลจริง | ตรวจ digest ตรงครบ 7 ตาราง: users 1, sessions 1, attempts 4, tracks 1, assets 5, playlists 1, playlist_versions 0 ณ จุดย้าย; บัญชีเดิมล็อกอินและเปิดเพลง/Playlist เดิมได้ |
| Smoke หลังย้าย | HTTPS origin smoke พร้อม `--audio-ai` ผ่านทุกขั้นกับ PostgreSQL และ S3 จริง ทั้งผู้ช่วยภาษา แยก 4 stems range/ZIP และปฏิเสธ anonymous access |
| Backup หลังย้าย | ชุด `20261029T042239Z` มี 2 users, 2 tracks, 2 playlists, 10 assets และ 12 S3 objects รวมบัญชีทดสอบใหม่; snapshot ผ่าน integrity/FK และ native dump อ่านสารบัญได้ |
| HTTPS จริง | `https://stemora.mydjplus.com` ตอบ 200 และตรวจใบรับรองผ่าน ทั้งผ่านโดเมนสาธารณะและเชื่อม origin ด้วย hostname/SNI เดิม; private API ตอบ 401 เมื่อไม่เข้าสู่ระบบ |
| AI และ S3 บน VPS | smoke ผ่านการสมัครบัญชีทดสอบ อัปโหลด WAV วิเคราะห์ เปิด range จัด Playlist โดย `assistant_used=true` ส่งออก ZIP และแยกเสียง AI จริงครบ 4 stems จาก private S3 |
| Browser บนโดเมนจริง | เข้าสู่ระบบ เปิดเพลง เปิด Playlist ที่บันทึกแล้ว โหลดและเล่นมิกเซอร์ 4 แทร็คสำเร็จ จากนั้นออกจากระบบ; ภาพ `production-studio.png` และ `production-playlist.png` ใน `docs/screenshots/` |
| ดูแล VPS | สร้าง backup จริง 6 objects พร้อมฐานข้อมูลและ manifests แล้ว; timer ตรวจใบรับรองทำงานและ service ทดสอบสำเร็จ; TicketPlus เดิมยังตอบ 200 หลังเพิ่ม vhost |

คำสั่งตรวจหลัก:

```bash
backend/.venv/bin/python -m unittest discover -s backend/tests -v
cd frontend
npm run lint
npm run build
cd ..
node scripts/check-i18n.cjs
```

คำสั่งตรวจ staging ที่เปิดสมัครสมาชิกได้:

```bash
python3 scripts/smoke.py --url http://localhost:18080
python3 scripts/smoke.py --url http://localhost:18080 --audio-ai
python3 scripts/smoke.py --url http://localhost:18080 --require-assistant --language en
```

ตัวเลือก `--audio-ai` ต้องติดตั้ง audio AI และเข้าถึง weights ได้ สร้างบัญชีและไฟล์ทดสอบใหม่ทุกครั้ง
ตัวเลือก `--require-assistant` ตรวจว่าเรียกผู้ช่วยภาษาและ model metadata probe สำเร็จจริง ใช้กับ environment ที่ตั้งค่า provider พร้อมแล้ว
การทดสอบ Docker ใช้บริการภาษาที่รันบน host ของเราและ persistent cache ของ weights ที่ดาวน์โหลดไว้แล้ว
วันที่ 29 ตุลาคม 2026 deploy และตรวจบน VPS ปลายทางจริงแล้ว โดย smoke ใช้เสียงสังเคราะห์สั้นเพื่อพิสูจน์เส้นทางงานครบขั้น ยังไม่ใช่ benchmark เพลงเต็มหรือโหลดหลายผู้ใช้
คำสั่ง smoke ที่ใช้ตรวจ origin บน VPS (ยังตรวจ TLS ด้วย hostname และใบรับรองตามปกติ):

```bash
python3 scripts/smoke.py --url https://stemora.mydjplus.com --origin-ip 143.198.204.118 --audio-ai --language en
```

ผล: `gateway=passed`, `private_upload_analysis=passed`, `audio_range=passed`, `playlist_zip=passed`, `storage=s3`, `assistant_used=true`, `anonymous_access=rejected`, `audio_ai=passed`, `language=en`, `quota_bytes=200000000`
บัญชีและไฟล์ทดสอบเป็นข้อมูลส่วนตัวแยกจากบัญชีผู้ใช้ ไม่มีรหัสผ่านแสดงในรายงาน
คู่มือติดตั้งอยู่ใน [deploy/README.md](../deploy/README.md) และรายละเอียดเครื่องจริงใน [deploy/PRODUCTION.md](../deploy/PRODUCTION.md)

## Client WebGPU (29 ตุลาคม 2026)

- Native browser ตรวจ secure context และ GPU adapter จริงผ่าน และแยก synthetic audio 2 วินาทีครบ 4 แทร็ค WAV 44.1 kHz พร้อม ZIP
- ทดสอบเพลง First light จากคลัง 16 วินาทีด้วย WebGPU ได้ 4 แทร็คในมิกเซอร์ และกดบันทึกเข้า cloud ผ่าน ยอดใช้พื้นที่เพิ่ม 11,289,776 bytes โดยไม่เก็บ ZIP ซ้ำ
- ทดสอบยกเลิก worker จากหน้าทดสอบ GPU แล้วหยุดงานได้
- Node + Python ตรวจ WAV stereo PCM16, ค่า non-finite, การรวม instrumental, ZIP/CRC และชื่อไฟล์ผ่าน
- ชุดทดสอบ backend รวม 41 รายการ ผ่าน 40 และข้าม 1 (PostgreSQL migration ต้องใช้ฐานทดสอบแยก)
- ชุด HTTP ใหม่ตรวจ auth/CSRF, ownership, idempotency, quota, malformed WAV, ความยาวไม่ตรงกัน, ZIP cleanup และการเปิดหลัง restart
- UI แปล TH/EN ครบ 528 messages และ production build ผ่าน ไฟล์ประมวลผล pin SHA-256
- ผล browser ข้างต้นเป็นการตรวจฟังก์ชัน ไม่ใช่ benchmark ความเร็วทุกอุปกรณ์ ต้องเตรียม shader ครั้งแรกและเปิดแท็บระหว่างประมวลผล

- Runtime ปิด autotune build จาก source ที่ pin ไว้ ทดสอบ WebGPU หลายช่วง 16 วินาทีได้ครบ 4 WAV และใช้ worker เดิมแยกโหมด 2 แทร็คต่อได้ โดย cache ยังใช้งานอยู่
- แยกการตรวจ origin จาก Cloudflare WAF หลังพบ 403 เฉพาะคำขอ health check จาก VPS; บริการ frontend/backend/database และ TicketPlus ยัง healthy

## Resumable cloud imports

- ชุดตรวจล่าสุด: 45 tests ผ่าน 44 / ข้าม 1 (ต้องใช้ PostgreSQL แยก); production build และ catalog TH/EN 537 messages ผ่าน
- ชุด WAV สังเคราะห์รวม 120,000,000 bytes อัปโหลดผ่าน HTTP ด้วยชิ้นละไม่เกิน 4,000,000 bytes และ commit เข้า private storage ได้ โดยไม่เพิ่ม ZIP ซ้ำ
- ตรวจ resume, retry ที่ซ้อนทับข้อมูลเดิม, restart, session หมดอายุ, CSRF, owner isolation, ขนาด/offset ผิด และ discard เฉพาะไฟล์ชั่วคราวผ่าน
- เว็บจริง runtime ใหม่แยก 4 stems จาก Smoke tone 2 วินาที และกดบันทึก cloud ผ่าน task `29ab8d19-efb5-4c9b-9415-6a8d5aa9b41e`
- ดาวน์โหลด WAV และ ZIP ผ่าน TLS origin พร้อมตรวจชื่อ host, CRC และ byte equality ผ่าน; WAV ทั้ง 4 ต่างกัน และโควตาไม่เพิ่มจากการดาวน์โหลด ZIP
- SHA-256 ของ WASM ที่ดาวน์โหลดผ่านโดเมนจริงตรงกับ build: `d3b03c11cc113c9c915e4eed1da7199bbab8081900ef4cb108bccd284e325a7a`
- หลังเผยแพร่ chunk API เว็บสาธารณะแยก 2 แทร็คและกดบันทึกสำเร็จ task `696afd96-a79d-49a3-a27f-65c2b4122bcb`; ตรวจ WAV 44.1 kHz stereo PCM16, ZIP CRC/bytes และยอดใช้ 4,000,640 จาก 200,000,000 bytes ผ่าน โดย ZIP ไม่เพิ่มโควตา
- GPU มี device-lost หนึ่งครั้งระหว่างทดสอบบน in-app browser; UI แจ้งข้อผิดพลาดโดยไม่ส่งไปประมวลผลที่ server อัตโนมัติ และลองใหม่สำเร็จ จึงยังต้องทดสอบความเร็ว/ความเสถียรกับเครื่องและเพลงจริงก่อนใช้งานหนัก
- ตรวจภาษาอังกฤษพบปุ่มสถานะ Saved ขาดคำแปลหนึ่งรายการ แก้แล้วและเพิ่มการตรวจ ternary messages; catalog ล่าสุด 538 messages
- Backup ก่อนเผยแพร่ chunk API: `20261029T144430Z` มี 31 objects และ PostgreSQL dump 17,372 bytes อ่านสารบัญผ่าน; frontend/backend/database/Garage ทำงาน และ TicketPlus ยัง healthy
- ภาพจากเว็บจริง: `docs/screenshots/production-client-webgpu-th.png` และ `production-client-webgpu-en.png`

## Operator Worker (30 ตุลาคม 2026)

- ติดตั้งแอป macOS `~/Applications/STEMORA Worker.app` พร้อม runtime ของตัวเองนอก repository และ token เฉพาะเครื่อง mode 600; VPS เก็บเฉพาะ hash
- ชุดทดสอบ local รวม 49 รายการ ผ่าน 48 / ข้าม PostgreSQL migration 1 รายการ; คิวใหม่ตรวจ concurrency, lease expiry/fencing, restart, quota reservation/release, retry cap, revocation, CSRF และ private results
- Native worker รับงานจริงและสร้าง PCM16 stereo WAV 44.1 kHz 2 แทร็คจากเสียง 1 วินาทีผ่าน; runtime แยกอิสระเลือก CPU สำรองเมื่อ MPS ประมวลผลไม่สำเร็จ ใช้ 8.89 วินาทีในการตรวจครั้งนี้ ไม่ใช่ benchmark เพลงเต็ม
- เว็บสาธารณะเลือกไฟล์และกดแยก 16 วินาทีได้ task `63cdeca2-85f0-4e04-a5dd-996107dde128`; ขณะปิดแอป/พักรับงาน งานอยู่ในคิว และโหลดเว็บใหม่แล้วยังคงอยู่
- เปิดรับงานจากแอปบน Mac แล้วได้ WAV 4 แทร็คที่แตกต่างกัน ตรวจ duration/sample format/CRC/ZIP byte equality ผ่าน TLS origin ที่ยังตรวจ hostname ตามปกติ
- ยอด Cloud หลังสำเร็จ 11,289,776 bytes จาก 200,000,000 bytes เท่ากับ WAV ทั้ง 4 ไฟล์ คืนพื้นที่ source/reservation และไม่เก็บ ZIP ซ้ำ
- Frontend production build ผ่าน; catalog TH/EN 560 messages และ Node/Python WAV/ZIP checks ผ่าน
- ครั้งแรก deployment หยุดก่อนเปลี่ยนบริการเพราะ docker cp สคริปต์ backup ได้ mode 600 ของ root; แก้ให้เฉพาะ public source script อ่านได้ใน unprivileged container แล้วเผยแพร่ครั้งถัดไปสำเร็จ
- รุ่นแรกยังรับทีละเพลงและต้องเปิดเครื่อง/อินเทอร์เน็ตไว้ งานที่ขาดการเชื่อมต่อเริ่ม inference ใหม่ได้สูงสุด 3 attempts
- ทดสอบ PostgreSQL จริงบน VPS ด้วย schema ชั่วคราวแยกจาก production: worker queue 4 tests และ migration/snapshot 1 test ผ่านครบ รวม 5 รายการ; log อยู่ใน `deploy-logs/worker-agent-20261030-r3/postgresql-tests.log`
- Backup ล่าสุด `20261030T052119Z` มี 37 objects; portable snapshot ครบ 9 ตารางรวม workers/stem_jobs ผ่าน integrity/foreign keys และ native PostgreSQL dump อ่านสารบัญผ่าน
- ตรวจเว็บหลังเผยแพร่รุ่น r3: เปิดงานที่กำลังรอจากประวัติได้ ยกเลิกงานจาก UI ได้และคืนพื้นที่จอง จากนั้นเปิดรับงานบน Mac กลับตามเดิม
- ภาพจริง: `docs/screenshots/stemora-worker-macos.png`, `production-worker-queued.png`, `production-worker-result-th.png` และ `production-worker-result-en.png`


## คิวหลายเพลงและถังขยะ (30 ตุลาคม 2026)

- เพิ่มการเลือกหลายไฟล์ ส่งคิว Worker ทีละไฟล์ แสดงผลรายรายการและนำไฟล์ที่ยังไม่ส่งออกได้; คิวสูงสุด 10 งานต่อบัญชี ภายในโควตาเดิม
- ตรวจ API 5 tests รวมย้ายถังขยะ กู้คืน ลบถาวรและคืนพื้นที่; ตรวจ account อื่นไม่สามารถลบหรือกู้คืนงานได้
- เว็บจริงส่งเสียงสังเคราะห์ 3 งาน แยกครบ 3 งาน; ย้ายถังขยะและกู้คืนผ่าน จากนั้นลบถาวรงานทดสอบหนึ่งงาน พื้นที่ลด 352,888 bytes
- Browser file chooser ยืนยันเลือกหลายไฟล์พร้อมกันได้; frontend production build และ ESLint ผ่าน

## ลบงานแยกเสียงทุกประเภทและแสดงพื้นที่ (30 ตุลาคม 2026)

- ปุ่มลบอยู่ตรงแถวงานใน Stem jobs / เพลงทั้งหมด ทั้งงาน Worker, WebGPU และงานรุ่นเดิม; งานกำลังประมวลผลของ Worker ถูกยกเลิกก่อนย้ายลงถังขยะ ส่วนงานรุ่นเดิมต้องรอให้เสร็จ
- ผลในถังขยะกู้คืนได้และยังนับพื้นที่ ลบถาวรมีคำยืนยัน ลบเฉพาะ object/asset ของเจ้าของ พร้อมคืนโควตา หาก object storage ตอบผิดพลาด สถานะค้างลบให้ลองซ้ำได้และไม่อนุญาตกู้ผลบางส่วน
- แสดงพื้นที่ที่เหลือและพื้นที่ประมาณของผล 4 แทร็ค (42.3 MB/นาที) รวมถึงแจ้งว่าต้องจองพื้นที่ไฟล์ต้นฉบับชั่วคราว
- ทดสอบ worker + WebGPU trash/restore/purge, การปฏิเสธข้ามบัญชี, อ่านไฟล์หลังลบ, การคืนโควตา และ build frontend ผ่าน; regression 60 tests ผ่าน 59 ข้าม 1 (ต้องใช้ PostgreSQL แยก)
- ตรวจรายการมากกว่า 50 งานแสดงครบและจัดการได้; TH/EN catalog 561 messages ตรงกัน
