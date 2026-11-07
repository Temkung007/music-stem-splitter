# PostgreSQL เฉพาะ STEMORA

Docker ใช้ PostgreSQL 17 จาก official image โดยล็อก digest ไว้ใน Compose
ฐานข้อมูล `stemora`, application role `stemora` และ volume `database-data` แยกจาก TicketPlus และแอปอื่น
ไม่มีการ publish พอร์ต 5432 ออก host อินเทอร์เน็ต backend ติดต่อชื่อ `database` ใน Docker network
application role ไม่มีสิทธิ์ superuser, สร้าง DB, สร้าง role หรือ replication
รหัสผ่านผู้ดูแลและแอปสุ่มแยกกันใน `.env` mode 600 ไม่แสดงรหัสผ่านบนเว็บหรือใน log

เครื่องจริง `143.198.204.118` ย้ายและเปิดใช้งานสำเร็จแล้วเมื่อ 29 ตุลาคม 2026
container `stemora-database-1` และ backend healthy ตรวจจาก backend ว่าใช้ DB/role `stemora` จริง
ข้อมูลเดิม 7 ตารางมีจำนวนแถวและ digest ตรงกันทั้งหมด บัญชีเดิมยังล็อกอิน เปิดเพลงและ Playlist เดิมได้
ทดสอบอัปโหลด วิเคราะห์ จัดเซ็ตด้วยผู้ช่วยภาษา แยกเสียง AI จริง และ ZIP จาก S3 หลังย้ายผ่านครบ
snapshot/dump หลังย้ายอยู่ที่ `backups/20261029T042239Z/` และเก็บ SQLite เดิมไว้สำหรับการย้อนกลับอย่างมีการตรวจข้อมูล

## เครื่องใหม่

`setup_deploy.py` เรียก `setup_database.py` เพื่อเตรียม credential ให้อัตโนมัติ แล้วใช้ Compose ตามคู่มือปกติ
ห้ามลบ `.env` หรือสุ่มรหัสใหม่หลัง volume ถูก initialize เพราะจะไม่ตรงกับรหัสที่อยู่ใน PostgreSQL
native บนเครื่องพัฒนายังใช้ SQLite เมื่อไม่ได้กำหนด `DATABASE_DRIVER=postgresql`

## ย้ายเครื่องเดิมจาก SQLite

ต้องสำรอง source, `.env`, image ของ backend และข้อมูลก่อน สคริปต์อัปเกรดที่ใช้กับเครื่องนี้คาดว่าสำเนา source เดิมอยู่ใน `rollback/source-before-postgres/`
แยก prepare กับ activate เพื่อให้ทดสอบ source และ build เสร็จขณะที่ backend เดิมยังรับงาน:

```bash
cd /var/www/stemora
python3 scripts/upgrade_postgres.py prepare --expected-host mydjplus-ticketsplus
# ตรวจผลทดสอบและ state=prepared ก่อน activate
python3 scripts/upgrade_postgres.py activate --expected-host mydjplus-ticketsplus
```

prepare เติมเฉพาะรหัสที่ขาด Build image และเปิด PostgreSQL ให้ healthy
activate ตรวจว่าไม่มีงานเสียงค้าง สำรองฐาน/objects/manifest หยุด backend ชั่วคราว แล้วสร้าง SQLite snapshot ล่าสุด
ข้อมูล 7 ตารางย้ายใน transaction เดียว ตรวจจำนวนแถวและ SHA256 ของข้อมูลทุกแถวก่อน commit
หากปลายทางมีข้อมูลอยู่แล้วจะปฏิเสธทั้งหมด ไม่มีการ truncate หรือ overwrite
บัญชี รหัสผ่านที่ hash แล้ว sessions metadata เพลง Playlist และประวัติเวอร์ชันคงเดิม S3 objects ไม่ย้ายที่

รายงานอยู่ใน `deploy-logs/postgres-upgrade/migration.json` และ `state.json`
SQLite snapshot กับรายงานอีกชุดอยู่ใต้ `/data/migrations/` ใน volume `workspace-data`
เก็บ SQLite เดิมไว้เพื่อ rollback หากเปิด PostgreSQL รับข้อมูลใหม่แล้ว ห้ามสลับกลับ SQLite โดยตรง เพราะข้อมูลใหม่จะตกหล่น

## สำรองและกู้

```bash
bash scripts/backup-docker.sh /var/www/stemora/backups
```

แต่ละชุดมี `workspace.sqlite3` ที่ snapshot จาก PostgreSQL แบบ repeatable-read, S3 objects, task manifests และ `postgresql.dump` แบบ custom
portable snapshot ใช้ `scripts/restore.py` ตามคู่มือเดิมได้ หรือใช้ `scripts/migrate_database.py <snapshot>` ย้ายเข้าฐาน PostgreSQL **ว่าง** ที่เตรียม environment ไว้แล้ว
หากกู้ dump ลง PostgreSQL ให้เลือก DB ว่างและตรวจชื่อ/เจ้าของก่อน:

```bash
docker compose exec -T database pg_restore -U postgres -d <empty-database> --exit-on-error < /path/to/postgresql.dump
```

ตรวจบัญชี จำนวนเพลง Playlist ประวัติ เปิดเสียง และ ZIP ก่อนสลับ backend ไปฐานที่กู้
อย่า restore ทับฐานจริง และอย่าใช้ `docker compose down -v` กับข้อมูลจริง
ชุด backup ใน VPS เดียวควรคัดลอกแบบเข้ารหัสไปเก็บนอกเครื่องด้วย

อ้างอิง: [PostgreSQL official image](https://hub.docker.com/_/postgres), [Psycopg row factories](https://www.psycopg.org/psycopg3/docs/advanced/rows.html)
