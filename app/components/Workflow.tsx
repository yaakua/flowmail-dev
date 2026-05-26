import { useLocale } from "./AppShell";
import { t } from "../i18n";

export function Stepper({ current }: { current: number }) {
  const locale = useLocale();
  const steps = [t(locale, "contacts"), "AI", t(locale, "emailContent"), t(locale, "preview"), t(locale, "approveAndSend"), t(locale, "ready")];
  return (
    <div className="stepper">
      {steps.map((step, index) => (
        <div className={index + 1 <= current ? "step done" : "step"} key={step}>
          <span>{index + 1}</span>
          <strong>{step}</strong>
        </div>
      ))}
    </div>
  );
}

export function MetricCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
