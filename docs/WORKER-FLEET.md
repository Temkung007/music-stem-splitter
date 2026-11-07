# STEMORA Worker หลายเครื่อง — 1.5.0

แต่ละ Mac ติดตั้ง PKG เดียวกันได้ แต่ต้องมี worker ID และคีย์เฉพาะเครื่อง ห้ามคัดลอก config.json ของเครื่องแรกไปเครื่องอื่น แต่ละเครื่องรับงานพร้อมกันตามสเปคได้ 1–4 งาน และหลายเครื่องรับคนละเพลงจากคิวกลางพร้อมกัน ไม่แบ่งเพลงเดียวให้หลายเครื่อง

## เพิ่ม Mac

1. ใช้ Apple Silicon, macOS 14 ขึ้นไป และพื้นที่ว่างอย่างน้อย 7 GB ติดตั้ง `STEMORA-Worker-Apple-Silicon-v1.5.0.pkg` ขณะเข้าสู่บัญชี Mac
2. เปิด `~/Applications/STEMORA Worker.app` เครื่องใหม่เริ่มในสถานะพัก
3. ส่งเฉพาะ `~/Library/Application Support/STEMORA Worker/enrollment.json` ให้ผู้ดูแล ไฟล์นี้มี ID ชื่อเครื่อง และ SHA-256 ของ token; raw token อยู่บน Mac เท่านั้น ห้ามส่ง config.json
4. ผู้ดูแลตรวจว่าเป็นเครื่องที่ไว้ใจ แล้ววาง enrollment.json บน VPS ในพื้นที่ส่วนตัว และเรียกคำสั่งด้านล่าง เปลี่ยน path/name ให้ตรงกับเครื่อง (ไม่ใช่ config.json)

```sh
docker cp /var/www/stemora/scripts/manage_workers.py stemora-backend-1:/tmp/manage_workers.py
docker cp /private/path/enrollment.json stemora-backend-1:/tmp/enrollment.json
docker exec -e PYTHONPATH=/app -w /app stemora-backend-1 python /tmp/manage_workers.py enroll --file /tmp/enrollment.json --name "Studio Mac 2"
```

คอนเทนเนอร์เชื่อม DB เฉพาะ STEMORA อยู่แล้ว ไม่ต้องเปิดพอร์ต DB หรือคัดลอกคีย์ DB มาที่เครื่อง Worker
5. เปิด “เปิดพร้อมเข้าสู่ระบบ Mac” และ “เปิดรับงานใหม่” ตรวจในรายการเครื่องว่าออนไลน์และพร้อมรับงาน

ผู้ดูแลดูรายชื่อด้วย `docker exec -e PYTHONPATH=/app -w /app stemora-backend-1 python /tmp/manage_workers.py list` และเพิกถอนโดยเปลี่ยนท้ายคำสั่งเป็น `revoke --id UUID` ใช้ DB/environment ของ STEMORA เท่านั้น

## คิวและความทนทาน

- จองงานภายใน transaction เดียวกันด้วย PostgreSQL advisory lock; Worker ที่รับช้ากว่าจะเห็นงานถัดไป
- heartbeat ทุก 20 วินาที, lease 180 วินาที; เครื่องหลุดจะคืนคิวให้เครื่องที่พร้อม สูงสุด 3 attempts
- lease เก่าถูกปฏิเสธหลังส่งต่อ จึงเขียนทับหรือ complete ผลของเครื่องใหม่ไม่ได้
- หน้า Worker แสดงคิวรวม ลำดับ เวลารอ ชื่อเพลง ความคืบหน้า และชื่อเครื่องที่ทำอยู่; fleet แสดงออนไลน์/พร้อม/พัก/กำลังทำ
- ข้อมูลคิวใช้สิทธิ์ operator เท่านั้น ไม่มีอีเมลผู้ใช้ object key หรือ token ส่งออกมา
- เครื่องเก่าไม่รับงาน profile ใหม่จนกว่าจะติดตั้ง runtime/น้ำหนักใหม่ครบ ไม่มีการลดรุ่นโมเดลเงียบ ๆ
- ปิดรับงานรอให้งานปัจจุบันเสร็จก่อนอัปเกรด ล็อกจอได้ แต่ต้องเปิดฝา เสียบชาร์จ และมีอินเทอร์เน็ต

## AI

งานเสียงร้อง/ดนตรีใหม่ใช้ Mel-Band RoFormer Kim Vocal 2 (MLX) โดยอัตโนมัติ งาน 4 แทร็คใช้ HTDemucs FT เมื่อเลือกคุณภาพละเอียด รายละเอียด รุ่นที่ pin และผลตรวจอยู่ใน `docs/AI-model-review-20261030.md` ชื่อโมเดลไม่ปรากฏในหน้าลูกค้า

ชุดติดตั้งไม่ฝังคีย์เครื่องต้นทาง รวมน้ำหนัก MLX ทั้งสอง engine ประมวลผลบน Mac ได้โดยไม่ต้องเรียกบริการ AI ที่คิดเงินต่อเพลง CPU fallback ของ Demucs บนเครื่องใหม่อาจดาวน์โหลดน้ำหนักเพิ่มครั้งแรก

การทดสอบหลายเครื่องเป็น HTTP concurrency test ด้วย worker identity สองตัวบน backend แยก ไม่ใช่การทดสอบกับ Mac จริงสองเครื่อง ปัจจุบันมี Mac จริงที่ลงทะเบียนหนึ่งเครื่อง

เครื่องใหม่เริ่มด้วยคุณภาพละเอียดสำหรับงาน 4 แทร็ค ผู้ดูแลลดเป็นมาตรฐานได้จากการตั้งค่า Worker หากต้องการความเร็ว

งานพร้อมกันในเครื่องเดียว: ดู `docs/WORKER-PARALLEL.md` สำหรับเพดาน RAM การพักรับงานเมื่อ RAM ตึง และผล benchmark บน M5
