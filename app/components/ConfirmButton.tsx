import { useState } from "react";
import { t, type Locale } from "../i18n";

export function ConfirmButton({
  locale,
  label,
  onConfirm,
  disabled
}: {
  locale: Locale;
  label: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="danger-button" disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open ? (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{t(locale, "confirmation")}</h2>
            <p>{t(locale, "confirmationBody")}</p>
            <div className="row-actions">
              <button className="secondary-button" onClick={() => setOpen(false)}>{t(locale, "cancel")}</button>
              <button className="danger-button" disabled={busy} onClick={confirm}>{t(locale, "approve")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
