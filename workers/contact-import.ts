import type { CsvImportResult } from "@flowmail/email-core";

const reportSampleLimit = 50;
const insertBatchSize = 500;

export type ContactImportReport = {
  totalRows: number;
  acceptedCount: number;
  importedCount: number;
  existingCount: number;
  skippedCount: number;
  duplicateCount: number;
  skipped: CsvImportResult["skipped"];
  duplicates: string[];
};

export async function runD1Batches(db: D1Database, statements: D1PreparedStatement[]) {
  const results: D1Result<unknown>[] = [];
  for (let index = 0; index < statements.length; index += insertBatchSize) {
    results.push(...await db.batch(statements.slice(index, index + insertBatchSize)));
  }
  return results;
}

export function countD1Changes(results: Array<Pick<D1Result<unknown>, "meta">>) {
  return results.reduce((total, result) => total + Number(result.meta?.changes ?? 0), 0);
}

export function summarizeContactImport(parsed: CsvImportResult, importedCount: number): ContactImportReport {
  const acceptedCount = parsed.contacts.length;
  const skippedCount = parsed.skipped.length;
  const duplicateCount = parsed.duplicates.length;
  return {
    totalRows: acceptedCount + skippedCount + duplicateCount,
    acceptedCount,
    importedCount,
    existingCount: Math.max(acceptedCount - importedCount, 0),
    skippedCount,
    duplicateCount,
    skipped: parsed.skipped.slice(0, reportSampleLimit),
    duplicates: parsed.duplicates.slice(0, reportSampleLimit)
  };
}
