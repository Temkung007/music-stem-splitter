# ตัวเลือก AI สำหรับ STEMORA — ตรวจ 30 ตุลาคม 2026

## ข้อเสนอ

Worker 1.4.0 ใช้ **Mel-Band RoFormer Kim Vocal 2 (MLX)** สำหรับงานเสียงร้อง/Instrumental ใหม่ และใช้ HTDemucs FT สำหรับงาน 4 แทร็คเมื่อเลือกคุณภาพละเอียด เลือกโมเดลให้ตรงงานและเครื่อง Mac ที่มีอยู่ ไม่มีโมเดลที่ยืนยันว่าดีที่สุดสำหรับทุกเพลง และยังไม่มีการฟัง blind A/B กับคู่เทียบ

| ตัวเลือก | เหมาะกับ | สถานะ/ข้อจำกัด |
|---|---|---|
| HTDemucs / HTDemucs FT | แยก 4 แทร็ค และงานทั่วไป | ใช้งานจริงอยู่ใน Worker; การแยกเสียงร้องซ้ำด้วยตัวเดิมให้การเปลี่ยนแปลงน้อยในคลิปที่ตรวจ |
| Mel-Band RoFormer Kim Vocal 2 | แยกเสียงร้องกับดนตรีโดยเฉพาะ | ต้นฉบับเผยแพร่ MIT และมี MLX conversion; ผ่าน functional benchmark บน M5 และนำมาใช้กับงาน 2 แทร็คใหม่ |
| BS-RoFormer | เสียงร้องหรือหลายแทร็คตาม checkpoint | งานวิจัยมีผล benchmark ที่ดี แต่ checkpoint ชุมชนต่างกัน ต้องตรวจคุณภาพและใบอนุญาตรายรุ่น |
| Windowed RoFormer ของ Smule | ทดลองลดต้นทุนการคำนวณเสียงร้อง | ผู้พัฒนารายงาน trade-off คุณภาพกับการคำนวณ; ยังไม่ทดสอบความเร็วจริงบน M5 ของเรา |

## สิ่งที่ตรวจจากแหล่งต้นทาง

- ต้นฉบับ Kim Vocal 2: https://huggingface.co/KimberleyJSN/melbandroformer ระบุ MIT ใน metadata ปัจจุบัน
- MLX conversion: https://huggingface.co/mlx-community/mel-roformer-kim-vocal-2-mlx ระบุ stereo 44.1 kHz, ประมาณ 228M parameters และให้คำนวณ instrumental จาก mixture - vocals พร้อมประวัติที่มาของ license และการทดสอบ parity
- BS-RoFormer paper: https://arxiv.org/abs/2309.02612 ผล SDX23/MUSDB เป็นผลของระบบและชุดข้อมูลในงานวิจัย ไม่ควรนำมาตีความว่า checkpoint ใด ๆ จะชนะไฟล์ของผู้ใช้โดยอัตโนมัติ
- MLX inference framework: https://github.com/ssmall256/mlx-audio-separator มีเส้นทาง RoFormer บน Apple Silicon; บาง catalog ใน https://huggingface.co/ssmall256/mlx-audio-separator ยังระบุ release ที่กำลังจะออก และ license รวมเป็น unknown จึงไม่เลือกชุดรวมนี้เป็น production โดยไม่ตรวจรายโมเดล
- Windowed RoFormer: https://github.com/smulelabs/windowed-roformer เป็น repository ผู้พัฒนา ระบุวิธีลดงานคำนวณและข้อแลกเปลี่ยนในผลวิจัย ไม่ใช่หลักฐานความเร็วบน Mac เครื่องนี้

## ขั้นตอนก่อนเลือกใช้จริง

1. ใช้เพลงต้นฉบับเดียวกัน หลายแนว รวมเสียงร้องไทย เสียงประสาน เพลงกลองหนัก และช่วงเงียบ
2. เทียบความดังให้ตรงกันและฟังแบบไม่เห็นชื่อเครื่องมือ ประเมินเสียงร้องครบ/ดนตรีรั่ว/ปลายคำ/เสียงประสาน/รีเวิร์บ
3. วัดเวลาทั้งงาน RAM สูงสุด และผลลัพธ์ที่ช้า/ล้มเหลว บน M5 16 GB ที่ใช้อยู่
4. แยกการทดสอบแยกเพลงต้นฉบับออกจากการเก็บเสียงร้องซ้ำ กรณี BAD ที่ได้รับเป็นผลจากการนำ vocals ของ STEMORA ไปแยกซ้ำ
5. ใช้ environment แยกและคงระบบเดิมเป็น fallback ก่อนปล่อยโมเดลใหม่ให้ลูกค้า

## ผลทดสอบการนำมาใช้จริง — Worker 1.4.0

- Kim Vocal 2 MLX BF16, repository revision `64cbfcb004e39430e5f584552c05949440ec39ce`, model SHA-256 `312c38e5b698f8dfaa4d6064e8f79010744825828917871a9d22673a43eb7fe5`; strict weight loading, ไม่รันโค้ดที่ดาวน์โหลดจาก model repository
- runtime แยก `runtime-vocals`, dependencies pin ใน `worker/requirements-vocals.txt`; ไม่มีค่าใช้บริการ inference ต่อเพลง
- Mac M5 16 GB: คลิป 24 วินาทีใช้ 11.31 วินาที; เพลง 225.094 วินาทีใช้ 86.65 วินาที (เฉพาะ inference/export helper รวมโหลดโมเดล ไม่รวม upload/download) ตัวเลขนี้ไม่ใช่ SLA
- เพลงทดสอบประกอบจาก vocals.wav + no_vocals.wav ของ STEMORA เพราะยังไม่ได้รับเพลงต้นฉบับก่อนแยก จึงไม่ใช่ benchmark SDR ต่อ clean ground truth
- 8 วินาทีต่อ chunk, 50% overlap, reflected context และ weighted overlap-add; identity tests ตรวจตัวอย่าง 1 sample/สั้น/ตรง chunk/ข้ามหลาย chunk max error < 1e-6
- WAV stereo 44.1 kHz PCM16, จำนวน sample ตรงอินพุต, finite output, peak < 1; vocals + instrumental เท่ากับ mixture × shared gain ภายใน quantization 2/32768
- ผ่าน silence, short input และหลายงานต่อ process เดียวแบบ warm; peak child RSS ที่ OS รายงานประมาณ 0.97 GB ในการทดสอบนี้ (ไม่ใช่ตัวเลขรวม GPU allocation ทั้งระบบ)
- BAD[vocals].wav มาจากการนำ STEMORA vocals ไปแยกซ้ำ จึงไม่ใช่ผลคู่เทียบที่แยกจากเพลงต้นฉบับอย่างอิสระ ยังไม่อ้างว่าชนะไฟล์นี้หรือดีที่สุดทุกเพลง ต้องฟังที่ความดังตรงกันและประเมินเพลงต้นฉบับเดียวกันเพิ่มเติม

ดูระบบคิวหลายเครื่องใน `docs/WORKER-FLEET.md`
