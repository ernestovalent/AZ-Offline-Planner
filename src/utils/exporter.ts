import type { Task, ParsedAdoData } from '../types/ado';
import { save as tauriSaveDialog } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportRow {
  id:          number;
  assignedTo:  string; // "Name <email>" when unchanged; display name when reassigned
  startDate:   string; // M/D/YYYY H:MM:SS AM/PM or empty string
  targetDate:  string; // M/D/YYYY H:MM:SS AM/PM or empty string
}

export interface ExportResult {
  csv:         string;
  rowCount:    number; // number of data rows (excluding header)
  isFullExport: boolean; // true → all tasks exported (no edits existed)
}

// ---------------------------------------------------------------------------
// Cell-formatting helpers
// ---------------------------------------------------------------------------

/**
 * Convert an ISO "YYYY-MM-DD" date to the ADO bulk-import datetime format:
 *   D/M/YYYY H:mm  (24-hour clock, no seconds)
 *
 * Example: "2026-06-30" → "30/6/2026 0:00"
 *
 * Returns an empty string for null / undefined / unparseable input.
 */
export function isoToAdoDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return '';
  const [y, m, d] = parts;
  return `${parseInt(d, 10)}/${parseInt(m, 10)}/${y} 0:00`;
}

/**
 * Always wrap `value` in double-quotes, escaping any internal double-quote
 * characters by doubling them (RFC 4180).
 * Returns an empty string (no quotes) when the value is empty — ADO treats
 * an unquoted empty field as "no value", matching its own export behaviour.
 */
function alwaysQuoted(value: string | number): string {
  const s = String(value ?? '');
  if (s === '') return '';
  return '"' + s.replace(/"/g, '""') + '"';
}

/**
 * Build the CSV content for ADO bulk import.
 *
 * Strategy:
 *  • When the user has made edits (localTasks differ from originalData):
 *    export ONLY the modified tasks (delta export – smallest possible set).
 *  • When nothing has been edited:
 *    export ALL tasks so the button always produces a useful artefact.
 *
 * Columns emitted:   ID | Assigned To | Start Date | Target Date
 *
 * "Assigned To" format:
 *  • Unchanged assignment → preserves the original "Name <email>" string
 *    so ADO can match the exact user account.
 *  • Changed assignment   → uses the display name (email lost during drag).
 */
export function buildExportCsv(
  localTasks: Task[],
  originalData: ParsedAdoData,
): ExportResult {
  // Build original task map for O(1) lookup
  const origMap = new Map<number, Task>();
  for (const t of originalData.orphanTasks) origMap.set(t.id, t);
  for (const epic of originalData.epics)
    for (const us of epic.userStories)
      for (const t of us.tasks) origMap.set(t.id, t);

  // Determine which tasks changed
  const changed = localTasks.filter(t => {
    const o = origMap.get(t.id);
    if (!o) return true;
    return (
      o.startDate                    !== t.startDate               ||
      o.targetDate                   !== t.targetDate              ||
      (o.assignedToName || '')       !== (t.assignedToName || '')
    );
  });

  const isFullExport = changed.length === 0;
  const rowsToExport  = isFullExport ? localTasks : changed;

  // Header
  // Column order matches the ADO bulk-import required format.
  const COLS = ['ID', 'Work Item Type', 'Title', 'Assigned To', 'Start Date', 'Target Date'];
  const lines: string[] = [COLS.join(',')];

  for (const t of rowsToExport) {
    const orig = origMap.get(t.id);

    // Keep original "Name <email>" when the assignment didn't change;
    // fall back to display name when the task was reassigned.
    const assignedTo =
      orig && (orig.assignedToName || '') === (t.assignedToName || '')
        ? orig.assignedTo         // original full string
        : t.assignedToName ?? ''; // post-drag display name

    lines.push(
      [
        alwaysQuoted(t.id),                          // "136178"
        alwaysQuoted(t.workItemType),                // "Task"
        alwaysQuoted(t.title),                       // "Implement login screen"
        alwaysQuoted(assignedTo),                    // "NAME <email>" or ""
        alwaysQuoted(isoToAdoDateTime(t.startDate)), // "M/D/YYYY 12:00:00 AM" or ""
        alwaysQuoted(isoToAdoDateTime(t.targetDate)),// "M/D/YYYY 12:00:00 AM" or ""
      ].join(','),
    );
  }

  return {
    csv:          lines.join('\r\n'),
    rowCount:     rowsToExport.length,
    isFullExport,
  };
}

// ---------------------------------------------------------------------------
// Save dialog + write
// ---------------------------------------------------------------------------

/**
 * True when the frontend is running inside a Tauri webview.
 * Used to switch between the native save dialog and the browser blob fallback.
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Open the OS-native "Save As" dialog, let the user choose a filename and
 * destination, then write the CSV to that path.
 *
 * When running outside Tauri (plain Vite dev server) it falls back to the
 * classic <a download> browser mechanism so development is never blocked.
 *
 * @param content  The CSV string to persist.
 * @param filename Suggested filename pre-filled in the dialog.
 * @returns        Promise that resolves when the file is saved, or resolves
 *                 immediately when the user cancels the dialog.
 */
export async function downloadCsv(content: string, filename: string): Promise<void> {
  if (isTauri()) {
    return saveCsvViaTauri(content, filename);
  }
  saveCsvViaBrowser(content, filename);
}

/** Native path (Tauri): dialog → Rust command writes the file. */
async function saveCsvViaTauri(content: string, filename: string): Promise<void> {
  const chosenPath = await tauriSaveDialog({
    title:       'Export CSV for ADO bulk import',
    defaultPath: filename,
    filters: [
      { name: 'CSV files', extensions: ['csv'] },
      { name: 'All files',  extensions: ['*']   },
    ],
  });

  // User cancelled the dialog → nothing to do.
  if (!chosenPath) return;

  // Delegate the actual write to the Rust side (NFR-5.1 — no external calls).
  // The BOM (\uFEFF) lets Excel open the file without an encoding mismatch.
  await invoke<void>('save_csv', {
    path:    chosenPath,
    content: '\uFEFF' + content,
  });
}

/** Fallback path (plain browser / Vite dev server without tauri dev). */
function saveCsvViaBrowser(content: string, filename: string): void {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
