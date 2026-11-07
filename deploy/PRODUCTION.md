# STEMORA บน VPS จริง

ติดตั้งและตรวจสำเร็จวันที่ 29 ตุลาคม 2026

| รายการ | ค่าที่ใช้งาน |
|---|---|
| เว็บไซต์ | https://stemora.mydjplus.com |
| VPS / Termkin profile | `143.198.204.118` / `mydjplus-ticketsplus` |
| Directory / Compose project | `/var/www/stemora` / `stemora` |
| ระบบ | Ubuntu 24.04 x86_64, 4 CPU, RAM ประมาณ 8 GiB ใช้ร่วมกับแอปเดิม |
| บริการ | Next.js, FastAPI, PostgreSQL เฉพาะ STEMORA, private Garage S3, Gemini API สำหรับอ่านคำสั่ง; แยกเสียงเริ่มต้นด้วย WebGPU ฝั่ง client, เลือก CPU เซิร์ฟเวอร์เป็นทางสำรองได้ และยังเก็บบริการ Ollama เดิมไว้ |
| ผู้ช่วยจัด Playlist | Gemini 3.8 Flash, สำรอง Gemini 3.5 Flash-Lite; ใช้ key เดียวกับ DJ AS ตามที่เจ้าของอนุญาต เก็บเฉพาะฝั่ง backend |
| ฐานข้อมูล | service `database`, DB/role `stemora`, volume `stemora_database-data`, รับเฉพาะ Docker network |
| โควตาฟรี | 200 MB ต่อบัญชี (`USER_STORAGE_BYTES=200000000`), รวมเพลง/แทร็ค/ZIP ที่เก็บไว้และถังขยะ |
| ภาษา | TH / EN เลือกได้บนหน้าล็อกอินและใน workspace; จำค่าใน browser และส่ง Accept-Language ให้ API |
| Nginx เดิม | container `ticketsplus-nginx` ของ TicketPlus |
| Live vhost | `/var/www/TicketPlus-dashboard/nginx/conf.d/stemora.mydjplus.com.conf` |
| ต้นฉบับ vhost | `/var/www/stemora/deploy/nginx/stemora.production.conf` |

เปิดเว็บไซต์แล้วเลือกสร้างบัญชีของคุณได้ ไม่มีบัญชี admin หรือรหัสผ่านเริ่มต้น
บัญชีตรวจระบบแยกต่างหาก เก็บเฉพาะเสียงสังเคราะห์และออกจากระบบใน browser แล้ว

## คำสั่งดูแล

เชื่อมต่อ profile ข้างต้นใน Termkin แล้วใช้:

```bash
cd /var/www/stemora
docker compose -f compose.yml -f compose.nginx.yml --profile ai ps
docker compose -f compose.yml -f compose.nginx.yml --profile ai logs --tail=80 backend
bash scripts/backup-docker.sh /var/www/stemora/backups
```

สำรองก่อนอัปเดต source แล้วใช้:

```bash
docker compose -f compose.yml -f compose.nginx.yml --profile ai up -d --build
```

ต้องใช้ไฟล์ override นี้ทุกครั้งที่ `up` เพื่อคงการผูกพอร์ตภายในและข้อจำกัดทรัพยากร
คง `.env`, `.env.storage`, `deploy/garage.toml` และ persistent volumes เดิมไว้ ห้ามใช้ `down -v` กับข้อมูลจริง
ห้ามพิมพ์ secret จากไฟล์เหล่านี้ลง log สาธารณะ

## Network และทรัพยากร

Frontend/API ผูกเฉพาะ Docker bridge ของ host `172.17.0.1:18081` และ `172.17.0.1:18082` ให้ Nginx เดิม proxy เข้ามา
Garage และบริการภาษารับภายใน Compose network เท่านั้น พอร์ต 80/443 ยังเป็นของ Nginx เดิม
`APP_ORIGIN=https://stemora.mydjplus.com`, `COOKIE_SECURE=1`
ค่าปัจจุบัน `STEMORA_TRUSTED_PROXIES=127.0.0.1,172.24.0.1` โดย `172.24.0.1` คือ source ที่ backend เห็นจาก proxy ผ่าน published port
หากสร้าง Docker network ใหม่ต้องตรวจ gateway และ proxy address อีกครั้งก่อนอัปเดตค่า

จำกัด RAM: frontend 384 MiB, backend 2560 MiB, Garage 256 MiB, assistant 1536 MiB
backend มีหนึ่ง worker และหนึ่งงานแยกเสียงต่อครั้ง; คิวรุ่นนี้ยังใช้ backend เดียว
PostgreSQL จำกัด RAM 512 MiB, 1 CPU และ 40 connections เพิ่มเติมจากบริการข้างต้น
ตรวจเวลาประมวลผลกับเพลงเต็มก่อนรับโหลดจำนวนมาก การทดสอบครั้งนี้ใช้เสียงสังเคราะห์สั้น

## HTTPS

ใบรับรองอยู่ใต้ `/var/www/TicketPlus-dashboard/nginx/certbot/conf/live/stemora.mydjplus.com/`
container `ticketsplus-certbot` เดิมตรวจต่ออายุทุก 12 ชั่วโมงและเห็น renewal config ของ STEMORA แล้ว
`stemora-tls-reload.timer` ตรวจทุกชั่วโมง และเรียก `scripts/reload-tls.sh` เพื่อทดสอบ config/reload Nginx เฉพาะเมื่อ certificate เปลี่ยน
ตรวจสถานะได้ด้วย:

```bash
systemctl status stemora-tls-reload.timer
systemctl show stemora-tls-reload.service -p Result
docker exec ticketsplus-nginx nginx -t
```

แก้ Nginx ต้องสำรองและทดสอบก่อน reload ทุกครั้ง คง ACME webroot ของ TicketPlus ไว้ให้การต่ออายุเข้าถึงได้

## Backup และย้อนการตั้งค่า

สร้าง backup แรกสำเร็จที่ `/var/www/stemora/backups/20261029T033718Z` มี SQLite, task manifests และ 6 objects
หลังย้าย PostgreSQL สร้าง backup ที่ `/var/www/stemora/backups/20261029T042239Z` สำเร็จ มี portable SQLite snapshot, `postgresql.dump`, manifests และ 12 objects
ตรวจ integrity/foreign keys ของ snapshot และอ่านสารบัญ dump ด้วย `pg_restore --list` ผ่านแล้ว
ก่อนเผยแพร่โควตา 200 MB และ TH/EN สำรองอีกชุดที่ `/var/www/stemora/backups/20261029T055643Z` พร้อม native dump ที่ตรวจสารบัญผ่านแล้ว
ก่อนเปลี่ยนผู้ช่วยภาษาเป็น Gemini สำรองชุด `/var/www/stemora/backups/20261029T070522Z` มี 18 objects และ PostgreSQL dump ที่ตรวจสารบัญผ่านแล้ว
สคริปต์ backup ใช้งานได้แล้ว แต่ยังไม่ได้ตั้งรอบสำรองอัตโนมัติหรือคัดลอกออกนอก VPS
ควรจัดเก็บสำเนาเข้ารหัสนอกเครื่องตามรอบใช้งาน; สำเนาบน VPS เดียวไม่ป้องกันการเสียทั้งเครื่อง
ขั้นตอนกู้ลง directory ใหม่อยู่ใน [README.md](README.md#storage-และสำรองข้อมูล)

สำเนา config Nginx ก่อนเพิ่มเว็บอยู่ที่ `/var/www/stemora/rollback/nginx-conf-before/`
หากต้องถอดเฉพาะ STEMORA ให้นำ vhost `stemora.mydjplus.com.conf` ออกจาก directory ที่ Nginx include แล้ว `nginx -t` ก่อน reload
อย่าคัดลอกทั้งชุดทับ vhost ปัจจุบัน เพราะเว็บอื่นอาจมีการปรับภายหลัง ปิด timer ของ STEMORA ก่อนถอดระบบ
เก็บ volumes และข้อมูลสำรองไว้สำหรับกู้คืน

ผลตรวจ HTTPS, S3, AI, Playlist, ZIP และ browser จริงอยู่ใน [verification.md](../docs/verification.md)
รายละเอียด PostgreSQL และการย้าย/กู้ข้อมูลอยู่ใน [POSTGRESQL.md](POSTGRESQL.md)
อัปเดตโควตา/สองภาษาด้วย `scripts/deploy_update.py` โดยสำรองข้อมูลก่อนเผยแพร่ รายงานอยู่ใน `deploy-logs/quota-i18n/`
เผยแพร่สำเร็จวันที่ 29 ตุลาคม 2026 สถานะ `ready`, `quota_bytes=200000000`, `languages=[th,en]`; HTTPS smoke ภาษาอังกฤษพร้อม audio AI ผ่านแล้ว
บัญชีที่มีข้อมูลเกินโควตาจะอ่าน/ดาวน์โหลดของเดิมได้ แต่เพิ่มไฟล์หรือผลลัพธ์ที่เกินโควตาไม่ได้ ไม่มีการลบข้อมูลเดิมอัตโนมัติ

Gemini เปิดใช้สำเร็จวันที่ 29 ตุลาคม 2026 โดย build/recreate เฉพาะ backend สถานะ `deploy-logs/gemini-20261029/state.json` เป็น `ready` ทั้ง primary/fallback ผ่านการเรียกจริง ดูการตั้งค่า ข้อมูลที่ส่ง และ cost guards ใน [GEMINI.md](GEMINI.md)
ไฟล์ key staging และไฟล์โอนชั่วคราวทั้งต้นทาง/ปลายทางถูกลบแล้ว `.env` ฝั่ง production เป็น mode 600; DJ AS ต้นทางยัง online

Client WebGPU เป็นค่าเริ่มต้นแล้ว แยก 2/4 แทร็คใน browser พร้อม WAV/ZIP และบันทึกเข้า private cloud ตามโควตา 200 MB ได้ โดยส่งชิ้นละไม่เกิน 4 MB และลองบันทึกต่อได้ ดู [CLIENT-STEMS.md](CLIENT-STEMS.md)
ทดสอบเว็บสาธารณะครบทั้ง 2/4 แทร็คและบันทึกจริง รวมถึงดาวน์โหลด WAV/ZIP ที่ origin ด้วย TLS hostname validation ผ่าน; backup ก่อน chunk API อยู่ที่ `backups/20261029T144430Z`
รายงานเผยแพร่หลักอยู่ใน `deploy-logs/webgpu-20261029/` และการอัปเดตอยู่ใน `webgpu-runtime-20261029/`, `webgpu-upload-20261029-r2/` และ `webgpu-upload-20261029-r3/`
GPU บางรอบอาจ device-lost; UI แจ้งข้อผิดพลาดและเลือกเซิร์ฟเวอร์เองได้ ต้องเปิดแท็บไว้และประเมินเวลาบน GPU ของผู้ใช้จริง

วันที่ 30 ตุลาคม 2026 เพิ่มคิว PostgreSQL และ Operator Worker บน Mac M5 ของผู้ดูแล ตั้ง `STEMORA_WORKER_ENABLED=1` ให้หน้าเว็บเลือกการแยกเสียงและบันทึก Cloud อัตโนมัติเป็นค่าเริ่มต้น ลูกค้าปิดหน้าเว็บแล้วกลับมารับผลได้ และยังเลือก WebGPU ในตัวเลือกการประมวลผลได้
รับงานทีละเพลงผ่าน HTTPS ขาออก ใช้สิทธิ์เฉพาะงานตาม lease โดยไม่เปิด DB/S3 ให้คอมผู้ดูแล; แผนและการดูแลใน [WORKER.md](WORKER.md)
รายงานอยู่ใน `deploy-logs/worker-agent-20261030-r2/` และ `worker-agent-20261030-r3/`; ฐานข้อมูลเพิ่มตาราง workers/stem_jobs และรวมใน native/portable backups
รุ่น r3 ตรวจเว็บสาธารณะส่งเพลง 16 วินาทีให้ Mac แล้วได้รับ 4 WAV กลับ private Cloud สำเร็จ รวมทั้งเปิดงานรอจากประวัติและยกเลิกผ่าน UI ได้; การทดสอบ queue/migration บน PostgreSQL จริงผ่านครบ 5 รายการ
Backup `backups/20261030T052119Z` มี 37 objects และ snapshot ครบ 9 ตาราง ตรวจ integrity/foreign keys และสารบัญ native dump ผ่าน; source manifest 116 ไฟล์ตรงกัน
แอปบน M5 รับงานอยู่ โดยยังปิดตัวเลือกเปิดพร้อม login; ผลทดสอบ runtime ใช้ CPU สำรองหลัง MPS ไม่สำเร็จ ต้องทดสอบเพลงเต็มก่อนกำหนดเวลารับประกันลูกค้า
