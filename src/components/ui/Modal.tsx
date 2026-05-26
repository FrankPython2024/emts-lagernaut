"use client";
import { useEffect } from "react";
import FocusTrap from "focus-trap-react";

type ModalProps = {
  open:     boolean;
  onClose:  () => void;
  title:    string;
  children: React.ReactNode;
  width?:   string;
};

export function Modal({ open, onClose, title, children, width = "max-w-lg" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <FocusTrap
      focusTrapOptions={{
        escapeDeactivates:      false,  // Escape wird vom keydown-Handler oben behandelt
        clickOutsideDeactivates: false,
        returnFocusOnDeactivate: true,
      }}
    >
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className={`relative w-full ${width} bg-white dark:bg-[#242526] rounded-2xl shadow-2xl border border-[#ced4da] dark:border-[#3e4042] mx-4 flex flex-col max-h-[90vh]`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#ced4da] dark:border-[#3e4042] flex-shrink-0">
            <h3 id="modal-title" className="text-lg font-bold text-[#1a1a1a] dark:text-[#e4e6eb]">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="text-[#65676b] hover:text-[#fa3e3e] text-2xl leading-none w-11 h-11 flex items-center justify-center rounded-lg hover:bg-[#f0f2f5] dark:hover:bg-[#3e4042] transition-colors flex-shrink-0"
            >
              ×
            </button>
          </div>
          <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        </div>
      </div>
    </FocusTrap>
  );
}
