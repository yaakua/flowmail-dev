import { describe, expect, it } from "vitest";
import { runComplianceChecks } from "./index";

describe("compliance checks", () => {
  it("blocks sends with missing consent source or sender domain", () => {
    const result = runComplianceChecks({
      fromEmail: "hello@other.com",
      allowedDomains: ["example.com"],
      subject: "Activation help",
      htmlBody: "<p>Hello</p>",
      textBody: "Hello",
      organizationAddress: "",
      totalRecipients: 1,
      suppressedRecipients: 0,
      consentlessRecipients: 1
    });
    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.code === "domain_not_allowed")).toBe(true);
  });
});
