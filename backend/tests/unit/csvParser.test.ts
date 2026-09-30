import { parseLeads } from '../../src/utils/csvParser';

describe('CSV & Plain Text Lead Parser', () => {
  it('should parse valid emails from a single column CSV with headers', () => {
    const csvContent = `email\njohn@example.com\nJANE@DOMAIN.COM\n`;
    const result = parseLeads(csvContent);

    expect(result.validCount).toBe(2);
    expect(result.validEmails).toEqual(['john@example.com', 'jane@domain.com']);
    expect(result.invalidRows).toHaveLength(0);
    expect(result.duplicateCount).toBe(0);
  });

  it('should deduplicate emails and count duplicates', () => {
    const csvContent = `user@reachinbox.com\nUSER@REACHINBOX.COM\nuser@reachinbox.com\n`;
    const result = parseLeads(csvContent);

    expect(result.validCount).toBe(1);
    expect(result.validEmails).toEqual(['user@reachinbox.com']);
    expect(result.duplicateCount).toBe(2);
  });

  it('should handle multi-column CSVs by finding email columns', () => {
    const csvContent = `First Name,Last Name,Email,Company\nAlice,Smith,alice@company.com,Acme\nBob,Jones,invalid-email,XYZ Corp\n`;
    const result = parseLeads(csvContent);

    expect(result.validEmails).toEqual(['alice@company.com']);
    expect(result.validCount).toBe(1);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0].reason).toContain('No valid email address');
  });

  it('should parse plain newline-separated text', () => {
    const textContent = `lead1@example.com\n\nlead2@test.org\n`;
    const result = parseLeads(textContent);

    expect(result.validEmails).toEqual(['lead1@example.com', 'lead2@test.org']);
    expect(result.validCount).toBe(2);
  });

  it('should return empty result for blank or whitespace content', () => {
    const result = parseLeads('   \n  \t  ');
    expect(result.validCount).toBe(0);
    expect(result.validEmails).toHaveLength(0);
  });
});
