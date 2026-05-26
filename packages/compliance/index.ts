import { validateSenderDomain } from "@flowmail/email-core";

export type ComplianceInput = {
  fromEmail: string;
  allowedDomains: string[];
  subject: string;
  htmlBody: string;
  textBody: string;
  totalRecipients: number;
  suppressedRecipients: number;
  consentlessRecipients: number;
};

export type ComplianceFinding = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

const deceptiveSubjectPatterns = [
  /\bfree money\b/i,
  /\burgent action required\b/i,
  /\byou won\b/i,
  /\bguaranteed\b/i
];

export function runComplianceChecks(input: ComplianceInput) {
  const findings: ComplianceFinding[] = [];
  const sender = validateSenderDomain(input.fromEmail, input.allowedDomains);

  if (!sender.ok) {
    findings.push({
      code: sender.reason ?? "invalid_sender",
      severity: "error",
      message: "From email must use a configured Cloudflare sending domain."
    });
  }

  if (input.totalRecipients <= 0) {
    findings.push({
      code: "empty_audience",
      severity: "error",
      message: "Campaign has no eligible recipients."
    });
  }

  if (input.suppressedRecipients > 0) {
    findings.push({
      code: "suppression_exclusions",
      severity: "warning",
      message: `${input.suppressedRecipients} recipients are excluded by suppression rules.`
    });
  }

  if (input.consentlessRecipients > 0) {
    findings.push({
      code: "missing_consent_source",
      severity: "error",
      message: "Every recipient must have a source or consent source before sending."
    });
  }

  if (deceptiveSubjectPatterns.some((pattern) => pattern.test(input.subject))) {
    findings.push({
      code: "risky_subject",
      severity: "warning",
      message: "Subject line looks risky for compliance or deliverability."
    });
  }

  return {
    ok: findings.every((finding) => finding.severity !== "error"),
    findings
  };
}
