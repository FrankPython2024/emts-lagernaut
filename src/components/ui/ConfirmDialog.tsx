"use client";
import { Modal } from "./Modal";

type ConfirmDialogProps = {
  open:        boolean;
  onClose:     () => void;
  onConfirm:   () => void;
  title:       string;
  message:     React.ReactNode;
  confirmText?: string;
  danger?:     boolean;
  loading?:    boolean;
};

export function ConfirmDialog({
  open, onClose, onConfirm, title, message,
  confirmText = "Bestätigen", danger = false, loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md">
      <div className="text-[#65676b] dark:text-[#b0b3b8] mb-6">{message}</div>
      <div className="flex gap-3 justify-end">
        <button
          onClick={onClose}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-[#f0f2f5] dark:bg-[#3e4042] text-[#1a1a1a] dark:text-[#e4e6eb] font-semibold hover:bg-[#ced4da] dark:hover:bg-[#555] transition-colors disabled:opacity-50"
        >
          Abbrechen
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={`px-4 py-2 rounded-lg font-bold text-white transition-colors disabled:opacity-50 ${
            danger
              ? "bg-[#fa3e3e] hover:bg-red-600"
              : "bg-[#0064d2] hover:bg-blue-700"
          }`}
        >
          {loading ? "..." : confirmText}
        </button>
      </div>
    </Modal>
  );
}
