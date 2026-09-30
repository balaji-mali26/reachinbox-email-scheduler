import { parse } from 'csv-parse/sync';

export interface ParseLeadsResult {
  validEmails: string[];
  invalidRows: Array<{
    row: number;
    raw: string;
    reason: string;
  }>;
  totalRows: number;
  validCount: number;
  duplicateCount: number;
}

// Robust email regex conforming to standard RFC 5322 simplified pattern
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function parseLeads(content: string): ParseLeadsResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      validEmails: [],
      invalidRows: [],
      totalRows: 0,
      validCount: 0,
      duplicateCount: 0,
    };
  }

  let records: string[][] = [];

  try {
    // Try parsing as structured CSV
    records = parse(content, {
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (_e) {
    // Fallback: split by line for raw plain-text lists
    records = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => [line]);
  }

  const seenEmails = new Set<string>();
  const validEmails: string[] = [];
  const invalidRows: Array<{ row: number; raw: string; reason: string }> = [];
  let duplicateCount = 0;

  records.forEach((row, index) => {
    const rowNumber = index + 1;
    // Flatten row or look for an email-like column
    const candidates = row.map((col) => col.trim()).filter(Boolean);

    if (candidates.length === 0) {
      return;
    }

    // Find candidate email in row
    let detectedEmail: string | null = null;

    // Check if first line might be a header like "email" or "Recipient Email"
    if (rowNumber === 1 && candidates.some((c) => /^(email|recipient|email address|leads)$/i.test(c))) {
      return; // Skip header row
    }

    for (const candidate of candidates) {
      const cleaned = candidate.toLowerCase();
      if (EMAIL_REGEX.test(cleaned)) {
        detectedEmail = cleaned;
        break;
      }
    }

    if (detectedEmail) {
      if (seenEmails.has(detectedEmail)) {
        duplicateCount++;
      } else {
        seenEmails.add(detectedEmail);
        validEmails.push(detectedEmail);
      }
    } else {
      invalidRows.push({
        row: rowNumber,
        raw: row.join(','),
        reason: 'No valid email address found in row',
      });
    }
  });

  return {
    validEmails,
    invalidRows,
    totalRows: records.length,
    validCount: validEmails.length,
    duplicateCount,
  };
}
