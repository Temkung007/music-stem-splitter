"use client";

import { useId } from "react";
import { useLocale } from "@/components/locale-provider";

export function StemStorageChoice({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId();
  const { t } = useLocale();
  return <div className="stem-storage-choice">
    <label htmlFor={id}>{t("การเก็บผลลัพธ์")}</label>
    <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="download">{t("แยกเพื่อดาวน์โหลด · ไม่ใช้พื้นที่ Cloud")}</option>
      <option value="cloud">{t("บันทึกใน Cloud · ใช้พื้นที่ 200 MB")}</option>
    </select>
    <p>{t(value === "download"
      ? "ดาวน์โหลด WAV / ZIP ภายใน 24 ชั่วโมง ผลลัพธ์จะถูกลบอัตโนมัติ ไม่ใช้พื้นที่ Cloud"
      : "เก็บผลลัพธ์ไว้ในบัญชีจนกว่าจะลบ ต้องมีพื้นที่ Cloud เพียงพอ")}</p>
  </div>;
}
