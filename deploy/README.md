# ติดตั้ง STEMORA บน VPS ของเรา

ชุดนี้ประกอบด้วยเว็บ Next.js, FastAPI, PostgreSQL, Garage S3, Caddy HTTPS และ Ollama แบบเลือกเปิดได้
S3, ฐานข้อมูลและ API ไม่ publish พอร์ตออกอินเทอร์เน็ต ผ่าน gateway เฉพาะเว็บและ authenticated API

ระบบจริงติดตั้งแล้วที่ https://stemora.mydjplus.com บน `143.198.204.118` โดยใช้ Nginx เดิมของเครื่อง
ดูคำสั่งดูแลเครื่องนี้ใน [PRODUCTION.md](PRODUCTION.md) และผลตรวจใน [../docs/verification.md](../docs/verification.md)

## เริ่มต้น

**เครื่องที่มีข้อมูล SQLite อยู่แล้วต้องย้ายข้อมูลก่อนสั่ง `up backend` ด้วย Compose รุ่นนี้** ดู [POSTGRESQL.md](POSTGRESQL.md) เพื่อสำรองและย้ายเข้าฐานใหม่อย่างตรวจสอบได้ ห้ามเปิดแอปด้วยฐานว่างทับการตั้งค่าเดิม

ติดตั้ง Docker Engine + Compose และ Git บน Linux VPS จากแหล่งทางการ แล้ว clone โปรเจกต์
เตรียมดิสก์ให้พอสำหรับเพลง ต้นแบบ AI แคช และข้อมูลสำรอง CPU ใช้ได้แต่เวลาประมวลผลต้องวัดกับเครื่องจริง
ไม่มีการทดสอบหรือรับประกันสเปกขั้นต่ำของผู้ให้บริการ VPS ใดโดยเฉพาะ

```bash
python3 scripts/setup_deploy.py --domain music.example.com
docker compose --profile ai up -d --build
docker compose --profile ai exec assistant ollama pull qwen2.5:1.5b
docker compose ps
```

ชี้ DNS ของโดเมนไปที่ IP ของ VPS และเปิด TCP 80/443 Caddy ขอใบรับรอง HTTPS ให้เมื่อโดเมนเข้าถึงเครื่องได้
จากนั้นเปิด https://music.example.com และสร้างบัญชีของคุณ
หากใช้ระบบส่วนตัวและสมัครครบแล้ว เปลี่ยน `ALLOW_REGISTRATION=0` ใน `.env` แล้ว `docker compose up -d backend` เพื่อปิดสมัครใหม่
ไม่มีบัญชี admin/default password ฝังใน source ไม่มี password reset ทางอีเมลในรุ่นนี้; ผู้ใช้ที่ยังเข้าสู่ระบบได้เปลี่ยนรหัสผ่านเองได้

หากทดสอบในเครื่อง ใช้ `python3 scripts/setup_deploy.py` (ไม่มี domain) เปิด http://localhost:8080 โดยใช้ cookie แบบ HTTP สำหรับ local เท่านั้น
ห้ามใช้ `COOKIE_SECURE=0` เมื่อเผยแพร่ HTTPS

## Environment

### เครื่องที่มี Nginx รับเว็บอื่นอยู่แล้ว

ใช้ `compose.yml` ร่วมกับ `compose.nginx.yml` เพื่อ publish เฉพาะ loopback พอร์ต 18081 (เว็บ) และ 18082 (API)
บริการ Caddy จะไม่เริ่มเองในโหมดนี้ จึงไม่แย่งพอร์ต 80/443 ของ Nginx เดิม
หาก Nginx อยู่ใน Docker ให้ตั้ง `STEMORA_BIND_IP` เป็น IP ของ Docker bridge บน host ที่ตรวจแล้ว และใช้ IP นั้นใน `proxy_pass`; ห้ามใช้ `0.0.0.0` เพื่อเปิด API ภายในโดยไม่จำเป็น
กำหนด `STEMORA_TRUSTED_PROXIES` เป็น IP ของ proxy/gateway ที่ API เห็นจริง เพื่อรับ client IP และ HTTPS scheme จาก proxy ที่เชื่อถือได้ หากสร้าง Docker network ใหม่ต้องตรวจ IP นี้อีกครั้ง
ตัวอย่าง vhost อยู่ใน `deploy/nginx/stemora.conf`; ตรวจชื่อโดเมนและ workflow ใบรับรองของเครื่องก่อนเปิดใช้งาน
ตั้ง `APP_ORIGIN=https://stemora.mydjplus.com` และ `COOKIE_SECURE=1` ใน `.env` โดยไม่เปลี่ยนคีย์ S3 เดิม

```bash
docker compose -f compose.yml -f compose.nginx.yml --profile ai up -d --build
docker compose -f compose.yml -f compose.nginx.yml --profile ai exec assistant ollama pull qwen2.5:1.5b
```

override นี้จำกัด CPU/RAM ของแต่ละบริการสำหรับเครื่องที่ใช้ร่วมกับแอปอื่น ต้องวัดเวลาประมวลผลและ RAM จริงของเพลงบนเครื่องนั้น
แยก directory และ Compose project ของ STEMORA และสำรอง config Nginx ก่อนเพิ่ม vhost ตรวจ `nginx -t` ก่อน reload ทุกครั้ง
หากใช้ Ollama ที่มีอยู่บน host ตั้ง `AI_BASE_URL=http://host.docker.internal:11434` และ `AI_MODEL` ให้ตรงกับที่ติดตั้งไว้ แล้วไม่ต้องเปิด profile `ai`

`setup_deploy.py` สร้าง `.env` และใช้ key จาก `.env.storage` เดิม หรือเรียกสร้างชุดใหม่หากยังไม่มี
อย่าลบ/สร้าง key ใหม่เมื่อมีข้อมูลแล้ว เพราะ bucket เดิมอาจผูกกับ key เดิม
`.env.storage` เป็น endpoint ฝั่ง host; backend container ใช้ `http://garage:3900` ภายใน network

| ค่า | ความหมาย |
|---|---|
| `SITE_ADDRESS` / `APP_ORIGIN` | hostname ของ gateway และ origin เต็มสำหรับตรวจ CSRF |
| `BIND_ADDRESS` | `127.0.0.1` สำหรับ local; `0.0.0.0` สำหรับ VPS ที่เปิดให้เข้าผ่าน gateway |
| `COOKIE_SECURE` | `1` สำหรับ HTTPS production |
| `ALLOW_REGISTRATION` | เปิด/ปิดสมัครบัญชีใหม่ |
| `USER_STORAGE_BYTES` | โควตาฟรีต่อบัญชี รวมเพลง แทร็คและ ZIP ที่เก็บไว้; ค่าเริ่มต้น 200 MB = 200,000,000 bytes |
| `INSTALL_AUDIO_AI` | ติดตั้งตัวแยกเสียง AI ใน image (`true`); ใช้ `false` สำหรับตรวจระบบโดยใช้ DSP |
| `AI_BASE_URL` / `AI_MODEL` | บริการ Ollama ภายใน; ไม่ส่งชื่อโมเดลขึ้น UI |
| `GARAGE_DEFAULT_*` | คีย์ S3 และชื่อ bucket ส่วนตัว |

อย่าเพิ่ม `--workers` มากกว่า 1 และอย่าขยาย backend หลาย replica ในสถาปัตยกรรมรุ่นนี้
PostgreSQL แยกเป็น service `database` ไม่มี host port และใช้ volume `database-data` ของ Compose project นี้
แอปใช้ role `stemora` ที่ไม่มีสิทธิ์ superuser/สร้าง role/สร้าง DB ส่วนรหัสผู้ดูแลเป็นคนละค่ากัน
`setup_database.py` เติมคีย์ที่ขาดลง `.env` โดยไม่เปลี่ยนคีย์เดิม ต้องเก็บรหัสไว้คู่กับข้อมูลใน volume
แม้ใช้ PostgreSQL แล้ว คิวงานแยกเสียงยังอยู่ในโปรเซส หากต้อง scale หลาย backend ต้องย้ายคิว สถานะงาน และ task manifests ไปส่วนกลางก่อน

## การเปิด AI

งานวิเคราะห์ BPM/คีย์ใช้ CPU และไม่ต้องดาวน์โหลด language model
ตัวแยกเสียง AI ถูกติดตั้งใน image เมื่อ `INSTALL_AUDIO_AI=true`; ครั้งแรกจะดาวน์โหลด weights ลง persistent volume `audio-models`
image backend เริ่มต้นบน x86_64 ใช้ PyTorch แบบ CPU หากต้องการ GPU ต้องกำหนด runtime และ PyTorch ให้ตรงกับอุปกรณ์เพิ่ม
บน Linux ARM ชุดติดตั้งจะ build audio dependency จาก source ด้วย Rust/C แล้วนำเครื่องมือ build ออกจาก image จึงใช้เวลาติดตั้งครั้งแรกมากกว่า x86_64
Ollama เป็นบริการแยก เปิดด้วย `--profile ai` แล้ว pull โมเดลตามคำสั่งด้านบน
หากผู้ช่วยภาษาไม่พร้อม ฟอร์มและตัวจัดลำดับจากข้อมูลเสียงยังใช้งานได้ ผลลัพธ์จะไม่บอกว่า AI ทำงานสำเร็จหากเรียก AI ไม่สำเร็จ

## Storage และสำรองข้อมูล

Garage ใน Compose นี้เป็น **single node, replication 1** เพื่อเริ่มบน VPS เครื่องเดียว จึงไม่มีสำเนาที่ทนต่อการสูญเสียทั้งเครื่อง
ต้องนำ backup ไปเก็บอีกเครื่อง/อีกสถานที่และทดสอบการกู้คืน หากต้องการ availability หลายเครื่องให้ออกแบบ Garage cluster ตาม [เอกสารทางการ](https://garagehq.deuxfleurs.fr/documentation/cookbook/real-world/)

PostgreSQL อยู่ใน `database-data`; งาน/manifest/cache และ SQLite เดิมที่เก็บสำหรับ rollback อยู่ใน `workspace-data`; object อยู่ใน `garage-data` การ `docker compose down` ปกติคงข้อมูลไว้
**อย่าใช้ `down -v` กับข้อมูลจริง** เพราะจะลบ persistent volumes

สำรองจาก deployment โดยไม่เผยพอร์ต S3 ด้วยคำสั่งนี้:

```bash
./scripts/backup-docker.sh ./backups
```

สคริปต์สร้าง snapshot ของฐานข้อมูลเป็น SQLite แบบ portable เพื่อใช้ restore tool เดิม และเก็บ `postgresql.dump` สำหรับกู้ PostgreSQL โดยตรง พร้อมคัดลอก objects กับ manifests ของงานและเก็บสิทธิ์ไฟล์เป็น private
นำ directory backup ออกไปเข้ารหัสและเก็บนอก VPS ข้อมูลสำรองในดิสก์เดียวกับ VPS ยังไม่ป้องกันการสูญเสียเครื่อง
สำหรับ deployment ที่รันตรงบน host ใช้ `backend/.venv/bin/python scripts/backup.py`

กู้คืนลง directory ใหม่ (ไม่เขียนทับข้อมูลเดิม):

```bash
python3 scripts/restore.py ./backups/20261029T000000Z --destination ./restored-workspace
```

ทดสอบโดยตั้ง `STEMORA_DATA_DIR` เป็น directory ที่กู้ และ `STORAGE_DRIVER=local` ก่อน
หากจะกลับไป S3 ให้กำหนด S3 ปลายทางแล้วรัน `scripts/migrate_storage.py ./restored-workspace/objects` คัดลอกต้นฉบับไว้เสมอ
เปลี่ยน volume ของ backend ไปชุดที่กู้หลังตรวจจำนวนเพลง บัญชี Playlist และเปิดเสียงได้ครบ

แคช S3 และข้อมูลต้นแบบ AI ใช้ดิสก์เพิ่มเติมจากโควตาไฟล์ของผู้ใช้ ตรวจ free space และกำหนดนโยบายล้างแคช/สำรองตามขนาดใช้งานจริง
ถังขยะเป็น soft delete ยังนับพื้นที่ ไม่มีการ purge เพลงผู้ใช้อัตโนมัติ

## อัปเดต

สำรองก่อนอัปเดต จากนั้น `git pull`, `docker compose build`, `docker compose --profile ai up -d`
งานที่ยังประมวลผลอยู่เมื่อ backend ถูกหยุดจะแจ้งไม่สำเร็จเพื่อให้เริ่มใหม่ เพลงและเพลย์ลิสต์ที่บันทึกแล้วคงอยู่
ตรวจ `docker compose logs --tail=100 backend` โดยไม่เผย `.env`, key หรือข้อมูลบัญชีใน log สาธารณะ

## ข้อจำกัดที่ต้องทราบ

- การติดตั้งบนเครื่องใหม่ต้องเตรียม IP/โดเมนและช่องทางเข้าถึงเครื่อง; ค่า network และ Nginx ของเครื่องจริงนี้ไม่ควรคัดลอกไปใช้โดยไม่ตรวจ
- ตรวจ build, storage และเสียงจริงบน VPS เป้าหมายแล้ว แต่ยังไม่ได้วัดโหลดหลายผู้ใช้หรือเวลาแยกเพลงเต็ม
- ไม่มีการส่งอีเมลยืนยัน/กู้รหัสผ่าน และไม่มีการแชร์ Playlist แบบสาธารณะในรุ่นนี้
- ไม่ได้เคลียร์สิทธิ์เพลงหรือ pretrained weights เพื่อใช้เชิงพาณิชย์ โปรดดู README หลักก่อนเปิดบริการเก็บเงิน

## ตรวจหลังติดตั้ง

บน staging ที่เปิดสมัครสมาชิกได้ รัน `python3 scripts/smoke.py --url http://localhost:8080` เพื่อทดสอบ gateway, บัญชีส่วนตัว, อัปโหลด, วิเคราะห์, range audio, จัดเซ็ต และ ZIP
สคริปต์สร้างบัญชีและเพลงทดสอบส่วนตัวใหม่ จึงควรใช้กับ staging หรือเครื่องทดสอบ
การทดสอบภายในเครื่องนี้ใช้พอร์ต 18080 เพราะพอร์ต 8080 มีแอปอื่นอยู่ ส่วนค่าเริ่มต้นของ setup สำหรับเครื่องใหม่ยังเป็น 8080
เพิ่ม `--audio-ai` เพื่อทดสอบแยกเสียง AI จริงจากไฟล์ใน S3 พร้อมตรวจ WAV ทั้ง 4 แทร็คและ ZIP; ครั้งแรกอาจต้องดาวน์โหลด weights และใช้เวลาหลายนาที
ถ้า CDN ปฏิเสธ client อัตโนมัติ ให้ตรวจ origin ด้วย `--origin-ip <IP>` โดย hostname, SNI และการตรวจใบรับรอง TLS ยังเหมือนเดิม แล้วตรวจเส้นทาง CDN ด้วย browser จริงเพิ่มด้วย ไม่ต้องปิดระบบป้องกันของ CDN
