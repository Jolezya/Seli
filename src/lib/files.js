// Back up / restore / export helpers. These are the user's insurance policy,
// so they deal in plain, portable files: JSON for a full round-trip, CSV for a
// spreadsheet (spec §8).

const CSV_COLUMNS = ['id', 'type', 'start_local', 'end_local', 'start_ts', 'end_ts', 'amount', 'side', 'descr'];

function csvCell(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Events as CSV, with human-readable local times alongside the raw epochs. */
export function toCSV(events) {
  const rows = events.map((e) => [
    e.id,
    e.type,
    new Date(e.start_ts).toLocaleString(),
    e.end_ts ? new Date(e.end_ts).toLocaleString() : '',
    e.start_ts,
    e.end_ts ?? '',
    e.amount ?? '',
    e.side ?? '',
    e.descr ?? '',
  ]);
  return [CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}

/** Trigger a download of `text` as a file. */
export function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A dated filename, so successive backups never overwrite one another. */
export function stamp(prefix, ext) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

/** Read a user-picked file as text. */
export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
