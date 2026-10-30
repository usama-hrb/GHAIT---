/**
 * Records as CSV for a spreadsheet: one column per field (in the order first seen), nested
 * values as JSON, and a UTF-8 BOM so Excel reads the Arabic text.
 */
export function toCsv(rows: readonly Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    // Records hold strings, numbers, booleans and JSON (tags, conflict records).
    const text =
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => cell(row[column])).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Saves text as a file on the device (works offline: nothing leaves the browser). */
export function download(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
