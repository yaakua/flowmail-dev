import { useEffect, useRef, useState } from "react";
import { AppShell, useLocale } from "../components/AppShell";
import { api } from "../lib/api";
import { t, translateStatus } from "../i18n";
import { MetricCard } from "../components/Workflow";

type ContactPanel = "import" | "contacts" | "suppressions";
type ImportState = "idle" | "importing" | "success" | "error";

export default function ContactsImport() {
  const locale = useLocale();
  const [contacts, setContacts] = useState<any[]>([]);
  const [suppressions, setSuppressions] = useState<any[]>([]);
  const [csv, setCsv] = useState("email,full name,source\nada@example.com,Ada Lovelace,signup");
  const [suppressionEmail, setSuppressionEmail] = useState("");
  const [report, setReport] = useState<any>(null);
  const [currentPanel, setCurrentPanel] = useState<ContactPanel>("import");
  const [importState, setImportState] = useState<ImportState>("idle");
  const [importMessage, setImportMessage] = useState("");
  const [selectedCsvFileName, setSelectedCsvFileName] = useState("");
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [nextContacts, nextSuppressions] = await Promise.all([
      api<any[]>("/api/v1/contacts"),
      api<any[]>("/api/v1/suppressions")
    ]);
    setContacts(nextContacts);
    setSuppressions(nextSuppressions);
  }

  useEffect(() => {
    load();
  }, []);

  async function importContacts() {
    const nextCsv = csv.trim();
    if (!nextCsv) {
      setImportState("error");
      setImportMessage(t(locale, "emptyCsvImport"));
      return;
    }

    setImportState("importing");
    setImportMessage("");
    try {
      const result = await api<any>("/api/v1/contacts/import", {
        method: "POST",
        body: JSON.stringify({ filename: selectedCsvFileName || "contacts.csv", csv: nextCsv })
      });
      setReport(result);
      await load();
      setImportState("success");
      setImportMessage(t(locale, "importCompleted", {
        accepted: acceptedImportCount(result),
        imported: importedImportCount(result),
        existing: existingImportCount(result),
        skipped: skippedImportCount(result),
        duplicates: duplicateImportCount(result)
      }));
    } catch (error) {
      setImportState("error");
      setImportMessage(t(locale, "importFailed", { message: errorMessage(error) }));
    }
  }

  async function suppressEmail() {
    await api("/api/v1/suppressions", {
      method: "POST",
      body: JSON.stringify({ email: suppressionEmail, reason: "manual", source: "operator" })
    });
    setSuppressionEmail("");
    await load();
  }

  function chooseCsvFile() {
    setCurrentPanel("import");
    window.requestAnimationFrame(() => {
      csvFileInputRef.current?.click();
    });
  }

  async function loadCsvFile(file: File | null) {
    if (!file) return;
    try {
      const text = await file.text();
      setCsv(text);
      setSelectedCsvFileName(file.name);
      setImportState("idle");
      setImportMessage(t(locale, "csvFileLoaded", { filename: file.name }));
    } catch (error) {
      setImportState("error");
      setImportMessage(t(locale, "csvFileReadFailed", { message: errorMessage(error) }));
    } finally {
      if (csvFileInputRef.current) csvFileInputRef.current.value = "";
    }
  }

  function updateCsv(value: string) {
    setCsv(value);
    setSelectedCsvFileName("");
    if (importState !== "importing") {
      setImportState("idle");
      setImportMessage("");
    }
  }

  const isImporting = importState === "importing";

  return (
    <AppShell aside={<ContactAside locale={locale} report={report} contacts={contacts} suppressions={suppressions} currentPanel={currentPanel} setCurrentPanel={setCurrentPanel} />}>
      <section className="page-heading">
        <div>
          <h1>{t(locale, "importContacts")}</h1>
          <p>{t(locale, "csvIntakeBody")}</p>
        </div>
      </section>
      <input
        ref={csvFileInputRef}
        aria-hidden="true"
        className="visually-hidden"
        tabIndex={-1}
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => loadCsvFile(event.currentTarget.files?.[0] ?? null)}
      />
      <section className="metric-row metric-row-4 compact-metrics">
        <MetricCard label={t(locale, "totalContacts")} value={contacts.length} note={t(locale, "importedRows")} />
        <MetricCard label={t(locale, "active")} value={contacts.filter((contact) => !contact.unsubscribed_at && !contact.suppression_reason).length} note={t(locale, "eligibleForReview")} />
        <MetricCard label={t(locale, "suppressed")} value={suppressions.length} note={t(locale, "manualAndAutomatic")} />
        <MetricCard label={t(locale, "lastImport")} value={acceptedImportCount(report)} note={t(locale, "acceptedRows")} />
      </section>

      {currentPanel === "import" ? (
        <section className="panel import-console" aria-busy={isImporting}>
          <div>
            <p className="eyebrow">{t(locale, "csvIntake")}</p>
            <h2>{t(locale, "importContacts")}</h2>
            <p className="muted">{t(locale, "csvIntakeBody")}</p>
          </div>
          <div>
            <textarea
              aria-label={t(locale, "csvContactsInput")}
              className="csv-input"
              id="contact-csv-input"
              value={csv}
              onChange={(event) => updateCsv(event.target.value)}
            />
            <div className="row-actions">
              <button className="secondary-button" onClick={chooseCsvFile}>{t(locale, "chooseCsvFile")}</button>
              <button disabled={isImporting || !csv.trim()} onClick={importContacts}>{isImporting ? t(locale, "importingContacts") : t(locale, "importContacts")}</button>
              <span className="muted">{selectedCsvFileName || t(locale, "activeContactRowsLoaded", { count: contacts.length })}</span>
            </div>
            {importMessage ? (
              <p className={`form-status ${importState === "error" ? "error" : "ok"}`} role={importState === "error" ? "alert" : "status"}>
                {importMessage}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {currentPanel === "contacts" ? (
        <section className="panel">
          <div className="panel-title-row">
            <h2>{t(locale, "allContacts")}</h2>
            <span className="muted">{t(locale, "showingContacts", { count: contacts.length })}</span>
          </div>
          <table>
            <thead>
              <tr><th>{t(locale, "contact")}</th><th>{t(locale, "company")}</th><th>{t(locale, "source")}</th><th>{t(locale, "status")}</th></tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td><strong>{contact.first_name || contact.email} {contact.last_name}</strong><br /><span className="muted">{contact.email}</span></td>
                  <td>{contact.company}</td>
                  <td>{contact.source || contact.consent_source}</td>
                  <td><span className="soft-pill">{translateStatus(locale, contact.suppression_reason || (contact.unsubscribed_at ? "unsubscribed" : "active"))}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {contacts.length === 0 ? <p className="muted">{t(locale, "noData")}</p> : null}
        </section>
      ) : null}

      {currentPanel === "suppressions" ? (
        <section className="panel">
          <div className="panel-title-row">
            <h2>{t(locale, "suppressions")}</h2>
            <span className="muted">{t(locale, "totalRecords", { count: suppressions.length })}</span>
          </div>
          <div className="inline-check-form">
            <label>
              {t(locale, "suppressEmail")}
              <input placeholder={t(locale, "emailPlaceholder")} value={suppressionEmail} onChange={(event) => setSuppressionEmail(event.target.value)} />
            </label>
            <span />
            <button disabled={!suppressionEmail} onClick={suppressEmail}>{t(locale, "suppressEmail")}</button>
          </div>
          <table>
            <thead><tr><th>{t(locale, "contact")}</th><th>{t(locale, "source")}</th><th>{t(locale, "lastUpdated")}</th></tr></thead>
            <tbody>
              {suppressions.map((suppression) => (
                <tr key={suppression.id}>
                  <td><strong>{suppression.email}</strong></td>
                  <td>{suppression.reason}</td>
                  <td>{new Date(suppression.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {suppressions.length === 0 ? <p className="muted">{t(locale, "noData")}</p> : null}
        </section>
      ) : null}
    </AppShell>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function acceptedImportCount(report: any) {
  return Number(report?.acceptedCount ?? report?.contacts?.length ?? 0);
}

function importedImportCount(report: any) {
  return Number(report?.importedCount ?? report?.contacts?.length ?? 0);
}

function existingImportCount(report: any) {
  return Number(report?.existingCount ?? 0);
}

function skippedImportCount(report: any) {
  return Number(report?.skippedCount ?? report?.skipped?.length ?? 0);
}

function duplicateImportCount(report: any) {
  return Number(report?.duplicateCount ?? report?.duplicates?.length ?? 0);
}

function ContactAside({
  locale,
  report,
  contacts,
  suppressions,
  currentPanel,
  setCurrentPanel
}: {
  locale: ReturnType<typeof useLocale>;
  report: any;
  contacts: any[];
  suppressions: any[];
  currentPanel: ContactPanel;
  setCurrentPanel: (value: ContactPanel) => void;
}) {
  const panels: Array<{ id: ContactPanel; title: string; count: number }> = [
    { id: "import", title: t(locale, "importContacts"), count: acceptedImportCount(report) },
    { id: "contacts", title: t(locale, "allContacts"), count: contacts.length },
    { id: "suppressions", title: t(locale, "suppressions"), count: suppressions.length }
  ];
  return (
    <div className="stack">
      <h2>{t(locale, "audienceProfile")}</h2>
      <div className="setup-progress">
        {panels.map((panel, index) => (
          <button className={currentPanel === panel.id ? "setup-step-mini complete" : "setup-step-mini"} key={panel.id} onClick={() => setCurrentPanel(panel.id)}>
            <span>{index + 1}</span>
            <strong>{panel.title} · {panel.count}</strong>
          </button>
        ))}
      </div>
      <section className="side-card">
        <h2>{t(locale, "importReport")}</h2>
        {report ? (
          <>
            <div className="metric"><strong>{importedImportCount(report)}</strong><span>{t(locale, "imported")}</span></div>
            <div className="metric"><strong>{skippedImportCount(report)}</strong><span>{t(locale, "skipped")}</span></div>
            <div className="metric"><strong>{duplicateImportCount(report)}</strong><span>{t(locale, "duplicates")}</span></div>
          </>
        ) : <p className="muted">{t(locale, "noData")}</p>}
      </section>
    </div>
  );
}
