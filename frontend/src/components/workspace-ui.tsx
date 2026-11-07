"use client";

import { useLocale } from "@/components/locale-provider";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const { t: tr } = useLocale();

  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="workspace-modal" onCancel={close}>
      <div className="modal-title">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label={tr("ปิดหน้าต่าง")}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Notice({
  text,
  dismiss,
}: {
  text: string;
  dismiss?: () => void;
}) {
  const { t: tr } = useLocale();

  return (
    <div className="workspace-notice" role="status">
      <span>{tr(text)}</span>
      {dismiss && (
        <button
          className="icon-button"
          onClick={dismiss}
          aria-label={tr("ปิดข้อความ")}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
