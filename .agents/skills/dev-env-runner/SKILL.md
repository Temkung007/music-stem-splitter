---
name: dev-env-runner
description: อัตโนมัติการเปิด Docker คอนเทนเนอร์, บูต Android Emulator หรือ iOS Simulator ให้แสดงหน้าต่าง GUI จริงบนหน้าจอ Desktop และรันทดสอบแอปพลิเคชันผ่าน mobile-mcp และ docker-mcp
---

# Dev Environment & Emulator Auto-Runner Skill

เรียกใช้ Skill นี้ทันทีเมื่อผู้ใช้สั่งให้ "รันระบบ", "เปิด emulator", "เทสแอป", หรือ "รัน docker พร้อมแอป"

## ขั้นตอนการทำงาน (Execution Workflow)

1. **ตรวจเช็คและสตาร์ท Server หรือ Docker:**
   - เช็ค `docker info 2>&1` หาก Docker Daemon พร้อม ให้รัน `docker compose up -d`
   - หาก Docker ยังไม่พร้อมหรือไม่จำเป็นต้องใช้ Docker ให้รัน Local Dev Server ของโปรเจกต์ (เช่น `npx next dev -p 3000`) เป็น Background Task ทันที เพื่อให้พอร์ตพร้อมใช้งาน

2. **ตรวจเช็คและบูต Mobile Emulator / Simulator (บังคับแสดงหน้าต่าง GUI จริง):**
   - เคลียร์โปรเซสค้าง: `taskkill /F /IM qemu-system-x86_64.exe /IM emulator.exe /T 2>$null`
   - ลบไฟล์/โฟลเดอร์ `.lock` แบบ Recurse:
     `Get-ChildItem -Path "$env:USERPROFILE\.android\avd\*.avd" -Filter "*lock*" -Recurse -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`
   - สั่งบูตแบบ Detached ผ่าน Windows Shell:
     `cmd.exe /c start "" "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd <AVD_NAME>` (หรือ `agent-desktop` tool `desktop_launch`)
   - รอจนกว่า `sys.boot_completed` จะเท่ากับ `1`
   - เรียก `desktop_focus_window` เพื่อดึงหน้าต่างโทรศัพท์ขึ้นมาด้านหน้าสุดบนจอ Desktop ของผู้ใช้

3. **Build / เปิดเว็บ & ทดสอบบน Emulator จริงผ่าน `mobile-mcp`:**
   - กรณีเป็นแอปมือถือ: สั่งติดตั้งและรันแอปลงบน Emulator/Simulator จริง
   - กรณีเป็นเว็บแอปพลิเคชัน: สั่งเปิด URL เข้าสู่เบราว์เซอร์ใน Android Emulator จริงผ่าน `adb shell am start -a android.intent.action.VIEW -d "http://10.0.2.2:<PORT>"`
   - ใช้ `mobile-mcp` หรือ `desktop_screenshot` จับภาพหน้าจอจากตัว Emulator จริงเพื่อยืนยันว่าเปิดขึ้นหน้าหลักได้สำเร็จโดยไม่แครช
