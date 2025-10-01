"use client";

import { useState, FormEvent } from "react";
import styles from "./ReportModal.module.css";

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

const REPORT_REASONS = [
  "Inappropriate content",
  "Harassment",
  "Spam",
  "Nudity",
  "Violence or threats",
  "Underage user",
  "Other",
];

export function ReportModal({ isOpen, onClose, onSubmit }: ReportModalProps) {
  const [selectedReason, setSelectedReason] = useState("");
  const [customReason, setCustomReason] = useState("");

  if (!isOpen) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (!selectedReason) {
      alert("Please select a reason");
      return;
    }

    const finalReason =
      selectedReason === "Other" && customReason.trim()
        ? customReason.trim()
        : selectedReason;

    onSubmit(finalReason);

    // Reset form
    setSelectedReason("");
    setCustomReason("");
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <h2>Report User</h2>
        <p className={styles.subtitle}>
          Please select a reason for reporting this user:
        </p>

        <form onSubmit={handleSubmit}>
          <select
            value={selectedReason}
            onChange={(e) => setSelectedReason(e.target.value)}
            className={styles.select}
            required
          >
            <option value="">Select a reason...</option>
            {REPORT_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {reason}
              </option>
            ))}
          </select>

          {selectedReason === "Other" && (
            <textarea
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Please describe the issue (max 500 characters)..."
              maxLength={500}
              className={styles.textarea}
              required
            />
          )}

          <div className={styles.buttons}>
            <button type="button" onClick={onClose} className={styles.cancel}>
              Cancel
            </button>
            <button type="submit" className={styles.submit}>
              Submit Report
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
