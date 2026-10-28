# StemX Studio - AI Music Stem Splitter 🎵

เว็บแอปพลิเคชันสำหรับแยกไฟล์เพลงเป็นแทร็คย่อย (Stems/Steps) ได้แก่ **เสียงร้อง (Vocals)**, **กลอง (Drums)**, **เบส (Bass)** และ **ดนตรีอื่นๆ (Instruments/Melody)** หรือแยกเป็น **Acapella & Karaoke (Instrumental)**

พัฒนาด้วย:
- **Frontend**: Next.js 16 (App Router, React 19, TypeScript, Tailwind CSS, Lucide Icons)
- **Backend API**: Python 3.12, FastAPI, Uvicorn, FFmpeg
- **AI Engine**: Demucs Deep Neural Network (Meta AI) พร้อม Apple Silicon GPU (MPS) Acceleration & High-Grade DSP Filter fallback

---

## ✨ ฟีเจอร์หลัก (Key Features)

1. **อัปโหลดไฟล์เพลงหลากหลายฟอร์แมต**: รองรับทั้ง `.mp3`, `.wav`, `.flac`, `.m4a`, `.aac`, `.ogg`
2. **โหมดการแยกแทร็ค**:
   - **4 Stems**: แยก 4 แทร็คอิสระ (Vocals, Drums, Bass, Other)
   - **2 Stems**: แยก 2 แทร็คสำหรับคาราโอเกะ (Vocals + Backing Instrumental)
3. **Multi-Track Synchronized Player & DJ Mixer**:
   - เล่น/หยุดทุกแทร็คพร้อมกันแบบ Real-time Synchronized
   - ปุ่ม **Solo (S)**: ฟังเฉพาะเสียงที่ต้องการแบบเดี่ยวๆ
   - ปุ่ม **Mute (M)**: ตัดเสียงแทร็คนั้นๆ (เช่น ตัดเสียงร้องเพื่อทำคาราโอเกะ หรือตัดกลองเพื่อซ้อมกลอง)
   - สไลเดอร์ปรับระดับเสียงแยกแต่ละแทร็ค (Volume Fader 0% - 150%)
   - แถบ Waveform Visualization แบบโต้ตอบได้ คลิกเพื่อเลื่อนท่อนเพลง (Scrubbing)
4. **Quick Presets**:
   - 🎤 **Acapella**: ฟังเฉพาะเสียงร้อง
   - 🎵 **Karaoke**: ตัดเสียงร้อง ฟังเฉพาะดนตรี
   - 🥁 **Drum & Bass**: ฟังเฉพาะกลองและเบส
   - 🔄 **รีเซ็ตทั้งหมด**: คืนค่าระดับเสียงและแทร็คทั้งหมด
5. **การดาวน์โหลด**:
   - ดาวน์โหลดแยกทีละ Stem (`.wav`)
   - ดาวน์โหลดรวมทุก Stem เป็นไฟล์เดียว (`.zip`)

---

## 🚀 วิธีการรัน (Getting Started)

### วิธีที่ 1: รันคำสั่งเดียว (แนะนำ)
เปิด Terminal ในโฟลเดอร์โปรเจกต์ แล้วรัน:

```bash
cd /Users/temkung007/Documents/Github/music-stem-splitter
./run.sh
```

คำสั่งนี้จะเริ่มทำงานทั้ง:
- **Backend**: http://localhost:8000
- **Frontend**: http://localhost:3000

เปิดเบราว์เซอร์ไปที่ **http://localhost:3000** เพื่อใช้งาน

---

### วิธีที่ 2: รันแยกทีละส่วน

#### 1. รัน Backend (FastAPI)
```bash
cd backend
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

#### 2. รัน Frontend (Next.js)
```bash
cd frontend
npm run dev
```

---

## 📦 โครงสร้างโปรเจกต์ (Project Structure)

```
music-stem-splitter/
├── backend/
│   ├── main.py             # FastAPI App & Audio processing logic
│   ├── requirements.txt    # Python dependencies
│   ├── start.sh            # Script สำหรับรัน backend
│   └── .venv/              # Python virtual environment
├── frontend/
│   ├── src/
│   │   └── app/
│   │       ├── page.tsx    # Multi-track Stem Mixer & UI
│   │       ├── layout.tsx  # Root Layout & Fonts
│   │       └── globals.css # Dark DJ Theme & Sliders
│   ├── package.json
│   └── next.config.ts
├── run.sh                  # All-in-one launcher script
├── .gitignore
└── README.md
```

---

## 🐙 วิธีนำขึ้น GitHub (Push to GitHub)

โปรเจกต์นี้ได้รับการทำ `git init` เรียบร้อยแล้ว หากต้องการสร้าง Repo ใหม่บน GitHub:

```bash
cd /Users/temkung007/Documents/Github/music-stem-splitter

# สร้าง GitHub Repository อัตโนมัติด้วย GitHub CLI (gh):
gh repo create music-stem-splitter --public --source=. --remote=origin --push

# หรือถ้าสร้าง Repo บนเว็บไซต์ GitHub แล้ว:
# git remote add origin https://github.com/Temkung007/music-stem-splitter.git
# git branch -M main
# git push -u origin main
```
