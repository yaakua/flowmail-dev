import { useState } from "react";
import { useLocale } from "./AppShell";
import { t } from "../i18n";

export type HelpTipProps = {
  title: string;
  summary: string;
  steps: string[];
  example?: string;
};

export function HelpTip({ title, summary, steps, example }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const locale = useLocale();

  return (
    <>
      <button className="help-button" type="button" aria-label={`Help: ${title}`} onClick={() => setOpen(true)}>?</button>
      {open ? (
        <div className="modal-backdrop">
          <div className="modal help-modal">
            <div className="modal-title-row">
              <h2>{title}</h2>
              <button className="icon-button" type="button" aria-label={t(locale, "close")} onClick={() => setOpen(false)}>×</button>
            </div>
            <p>{summary}</p>
            <ol className="help-steps">
              {steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            {example ? (
              <div className="example-box">
                <strong>{t(locale, "example")}</strong>
                <code>{example}</code>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
