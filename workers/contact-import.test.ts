import { describe, expect, it } from "vitest";
import { countD1Changes, summarizeContactImport } from "./contact-import";
import type { CsvImportResult } from "@flowmail/email-core";

describe("contact import reports", () => {
  it("keeps persisted reports compact for large imports", () => {
    const parsed: CsvImportResult = {
      contacts: Array.from({ length: 5000 }, (_, index) => ({
        email: `person-${index}@example.com`,
        first_name: "Person",
        custom_fields_json: {}
      })),
      skipped: Array.from({ length: 60 }, (_, index) => ({ row: index + 1, reason: "invalid_email", value: "bad" })),
      duplicates: Array.from({ length: 60 }, (_, index) => `duplicate-${index}@example.com`)
    };

    const report = summarizeContactImport(parsed, 4990);

    expect(report).toMatchObject({
      totalRows: 5120,
      acceptedCount: 5000,
      importedCount: 4990,
      existingCount: 10,
      skippedCount: 60,
      duplicateCount: 60
    });
    expect(report.skipped).toHaveLength(50);
    expect(report.duplicates).toHaveLength(50);
    expect(JSON.stringify(report).length).toBeLessThan(10000);
  });

  it("counts D1 insert changes from batch results", () => {
    expect(countD1Changes([
      { meta: { changes: 2 } } as D1Result<unknown>,
      { meta: { changes: 0 } } as D1Result<unknown>,
      { meta: { changes: 3 } } as D1Result<unknown>
    ])).toBe(5);
  });
});
