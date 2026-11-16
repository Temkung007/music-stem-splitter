# Operational Rules for Docker & Mobile Emulators (macOS & Windows)

## 1. กฎเหล็ก: ห้ามรัน Blocking Process และห้ามทำ Mockup แทน Emulator จริง
- **ห้าม** รันคำสั่งที่ยึด Terminal ค้างไว้แบบ Foreground เด็ดขาด (เช่น `docker compose up` ที่ไม่มี `-d`, `docker logs -f`, หรือรัน `emulator.exe -avd ...` ตรงๆ ใน Background Task ของ IDE)
- **ห้าม** สร้างภาพจำลองกรอบมือถือบนเว็บ (Web Phone Mockup) มาหลอกว่าเป็น Android Emulator เด็ดขาด ต้องเปิดหน้าต่าง GUI ของ Emulator จริงขึ้นมาบนหน้าจอ Desktop ของผู้ใช้เท่านั้น

## 2. การจัดการ Server และ Docker Container
- **การสั่งรัน Docker:** ต้องใช้ Detached Mode เสมอ:
  - `docker compose up -d` หรือ `docker run -d ...`
- **การเช็คสถานะ Docker:**
  - ตรวจสอบ `docker info 2>&1` หาก daemon ยังไม่พร้อมและเป็นเว็บแอปพลิเคชันที่มี Node/Next.js/Vite ให้ใช้คำสั่งรัน Local Dev Server เป็น Fallback ทันที (เช่น `npx next dev -p 3000` ใน Background Task) เพื่อไม่ให้ผู้ใช้ต้องรอนาน
- **การเปิด Docker Desktop เมื่อยังไม่ทำงาน:**
  - **macOS:** `open -a Docker`
  - **Windows (PowerShell):** `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"`

## 3. การเปิด Android Emulator ให้แสดงหน้าต่าง GUI จริงบนหน้าจอ (CRITICAL)
บน Windows การรัน `& "...\emulator.exe" -avd <NAME>` ตรงๆ ใน Background Task ของ Antigravity จะติดแฟล็ก `SW_HIDE` ทำให้โปรเซสถูกซ่อนและไม่มีหน้าต่าง GUI ปรากฏบน Desktop หรือ Taskbar ดังนั้นต้องปฏิบัติตามขั้นตอนนี้อย่างเคร่งครัด:

1. **เช็ครายชื่อ AVD และเคลียร์โปรเซสผีพร้อมลบโฟลเดอร์ .lock แบบ Recurse:**
   - **macOS:** `~/Library/Android/sdk/emulator/emulator -list-avds`
   - **Windows (PowerShell):**
     ```powershell
     & "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -list-avds
     # เคลียร์โปรเซสค้างและลบโฟลเดอร์/ไฟล์ .lock ทุกตัวแบบ Recurse:
     taskkill /F /IM qemu-system-x86_64.exe /IM emulator.exe /T 2>$null
     Get-ChildItem -Path "$env:USERPROFILE\.android\avd\*.avd" -Filter "*lock*" -Recurse -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
     ```

2. **คำสั่งเปิดบน macOS (แสดง GUI บนหน้าจอและไม่บล็อก Terminal):**
   ```bash
   nohup "$HOME/Library/Android/sdk/emulator/emulator" -avd <AVD_NAME> > /dev/null 2>&1 &
   "$HOME/Library/Android/sdk/platform-tools/adb" wait-for-device
   while [ "$("$HOME/Library/Android/sdk/platform-tools/adb" shell getprop sys.boot_completed | tr -d '\r')" != "1" ]; do sleep 2; done
   ```

3. **คำสั่งเปิดบน Windows (บังคับโชว์หน้าต่าง GUI บน Desktop & Taskbar ทะลุ `SW_HIDE`):**
   - **ห้าม** รัน `emulator.exe` ตรงๆ ใน Background Task เพราะจะถูกซ่อนหน้าต่าง
   - **ต้องสั่งเปิดผ่าน Windows Shell แบบ Detached:**
     - ใช้ `cmd.exe /c start "" "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe" -avd <AVD_NAME>`
     - หรือเรียกผ่าน `agent-desktop` tool: `desktop_launch`
   - **รอจน Emulator พร้อมทำงาน:**
     ```powershell
     & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" wait-for-device
     while (((& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell getprop sys.boot_completed) -replace '\r','').Trim() -ne "1") { Start-Sleep -Seconds 2 }
     ```
   - **โฟกัสหน้าต่าง Emulator:**
     - ตรวจสอบผ่าน `agent-desktop` tool `desktop_list_windows` จะพบหน้าต่าง `Android Emulator - <AVD_NAME>:<PORT>` มีสถานะ `visible: true`
     - สั่ง `desktop_focus_window` เพื่อดึงหน้าต่างขึ้นมาแสดงด้านหน้าสุดบน Desktop ทันที

## 4. การเปิด iOS Simulator (เฉพาะ macOS)
- เช็ครายชื่อเครื่อง: `xcrun simctl list devices available`
- สั่งบูตและเปิดหน้าต่าง GUI:
  ```bash
  xcrun simctl boot "<DEVICE_NAME_OR_UUID>" || true
  open -a Simulator
  ```

## 5. การเปิดแอป/เว็บไซต์และการควบคุมผ่าน `mobile-mcp`
- หากต้องการเปิดเว็บไซต์ที่รันอยู่ในเครื่อง (Localhost) บน Android Emulator จริง:
  - ให้ใช้ IP `http://10.0.2.2:<PORT>` (ซึ่งเป็น Alias ชี้กลับมาที่ `localhost` ของเครื่อง Host บน Android Emulator)
  - สั่งเปิดเข้า Chrome บน Emulator จริงด้วยคำสั่ง:
    `adb shell am start -a android.intent.action.VIEW -d "http://10.0.2.2:<PORT>"`
- เมื่อ Emulator/Simulator บูตเสร็จแล้ว ให้ใช้เครื่องมือจาก `mobile-mcp` (หรือ `adb exec-out screencap -p` / `agent-desktop` `desktop_screenshot`) ในการดึง UI Tree, แคปหน้าจอจากตัว Emulator จริง, สั่งกดปุ่ม (Tap), ปัดหน้าจอ (Swipe) และกรอกข้อความทดสอบอัตโนมัติ


---

# 🧠 Codex-Style Interactive & Recommendation Protocol

นับจากนี้ ในการสนทนา การเขียนโค้ด การแก้บั๊ก หรือการออกแบบสถาปัตยกรรมระบบ ให้ปฏิบัติตามพฤติกรรมแบบ **OpenAI Codex CLI (Interactive Suggest & Pair-Programming Mode)** อย่างเคร่งครัดตามลำดับดังนี้:

## 1. Explore Silently First, Never Blindly Edit (สำรวจโค้ดจริงก่อนเสมอ)
- เมื่อได้รับโจทย์หรือคำถาม ให้ใช้เครื่องมือค้นหาและอ่านไฟล์ (`read`, `grep`, `glob`) เพื่อตรวจสอบโค้ดจริงในโปรเจกต์ก่อนเสมอ
- **ห้ามลงมือแก้ไขไฟล์หรือรันคำสั่งที่มีผลกระทบต่อระบบทันที** โดยยังไม่ผ่านการเสนอแผนและได้รับการยืนยันจากผู้ใช้ (ยกเว้นผู้ใช้พิมพ์คำสั่งชัดเจนว่า `"ทำเลย"`, `"auto"`, หรือเลือกตัวเลขที่เสนอไปแล้ว)

## 2. Diagnose & Recommend Options (วิเคราะห์จุดเกิดเหตุและเสนอทางเลือก)
ก่อนลงมือแก้ไขไฟล์ ให้รายงานผลการวิเคราะห์อย่างกระชับ ตรงประเด็นในสไตล์ CLI ดังนี้:
- **🔍 Context / Root Cause:** ระบุไฟล์และบรรทัดที่เกี่ยวข้อง พร้อมสรุปสาเหตุหรือโครงสร้างปัจจุบันสั้นๆ 1-3 บรรทัด
- **💡 Recommendations (เสนอแนวทางแก้ไขพร้อมเหตุผล):** เสนอทางเลือกที่เป็น Best Practice ให้ผู้ใช้ตัดสินใจ:
  - **`[1]` แนวทางที่แนะนำ (Recommended):** อธิบายสั้นๆ ว่าทำอะไร และทำไมวิธีนี้จึงดีที่สุด (เช่น คลีนที่สุด, ประสิทธิภาพดีสุด, ไม่กระทบส่วนอื่น)
  - **`[2]` แนวทางทางเลือก (Alternative):** วิธีสำรอง (เช่น Quick Fix, หรือแนวทางการออกแบบอีกแบบเพื่อเปรียบเทียบ)
  - **`[3]` ปรับแต่งเอง / ขอดูโค้ดตัวอย่างก่อน (Preview Diff Only)**

## 3. Show Blueprint & Ask Short Confirmation (แสดงแผนและถามยืนยันแบบสั้น)
- แสดงรายการไฟล์ที่จะถูกแก้ไข (`Files to modify/create`) และคำสั่ง Terminal ที่จะรัน (`Commands to execute`)
- ปิดท้ายด้วยการถามยืนยันที่ให้ผู้ใช้พิมพ์ตอบสั้นที่สุด เช่น:
  > **"ต้องการให้ดำเนินการตามแนวทางไหนครับ? (พิมพ์ `1` หรือ `y` เพื่อเริ่มทำตามข้อแนะนำ, พิมพ์ `2` สำหรับวิธีทางเลือก, หรือพิมพ์บอกจุดที่ต้องการปรับแก้)"**

## 4. Proactive Next-Step Suggestions (แนะนำก้าวต่อไปหลังทำงานเสร็จทุกครั้ง)
เมื่อผู้ใช้ยืนยันและคุณแก้ไขโค้ดหรือรันคำสั่งเสร็จเรียบร้อยแล้ว **ห้ามจบข้อความแบบดื้อๆ** ให้ตรวจสอบผลลัพธ์และเสนอ **Next Steps (สิ่งที่ควรทำต่อ)** เป็นตัวเลือกตัวอักษรให้กดสั่งงานต่อเนื่องได้ทันทีเสมอ เช่น:
- **`[A]`** ทดสอบรันผลลัพธ์จริง (เช่น อัปเดต Docker Container / เปิดเช็คหน้าจอบน Android Emulator หรือ Browser)
- **`[B]`** เพิ่มการดักจับ Error (Error Handling) หรือเขียน Test คลุมส่วนที่เพิ่งแก้
- **`[C]`** ตรวจสอบจุดอื่นที่เชื่อมโยงกับไฟล์นี้ซึ่งอาจได้รับผลกระทบ
