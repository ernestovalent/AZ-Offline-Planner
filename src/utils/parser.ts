import * as XLSX from 'xlsx';
import type {
  AdoRawRow,
  AdoWorkItem,
  Task,
  UserStory,
  Epic,
  ParsedAdoData,
  WorkItemType,
} from '../types/ado';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TASK_TYPES: WorkItemType[] = ['Task', 'Bug', 'Issue'];
const ACCEPTED_TYPES: WorkItemType[] = ['Epic', 'User Story', 'Task', 'Bug', 'Issue'];

/**
 * Parse a raw date string from ADO export ("M/D/YYYY H:mm:ss AM/PM") into
 * an ISO date string "YYYY-MM-DD", or return null if not parseable.
 */
function parseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

/**
 * Parse the "Original Estimate" field into a numeric hour value.
 * ADO stores this as a plain number string (e.g. "8", "17.5").
 * Returns null when the value is absent or non-numeric.
 */
function parseEstimate(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}

/**
 * Extract the display name from "FULL NAME <email@domain.com>".
 * Falls back to the raw string if the pattern is not found.
 */
function extractName(raw: string | undefined | null): string {
  if (!raw) return '';
  const match = raw.trim().match(/^(.+?)\s*<[^>]+>$/);
  return match ? match[1].trim() : raw.trim();
}

/**
 * Resolve the title for a row: ADO exports use Title 1/2/3 to encode the
 * hierarchy level.  The first non-empty value wins.
 */
function resolveTitle(row: AdoRawRow): string {
  return (row['Title 1'] || row['Title 2'] || row['Title 3'] || '').trim();
}

/**
 * Validate that the required columns are present in the sheet headers.
 * Returns a list of missing required column names.
 */
export function validateHeaders(headers: string[]): string[] {
  const required = ['ID', 'Work Item Type'];
  return required.filter((h) => !headers.includes(h));
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

/**
 * Convert a File object (CSV or XLSX) into a structured ParsedAdoData result.
 */
export async function parseAdoFile(file: File): Promise<ParsedAdoData> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });

  // Use the first sheet
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Convert to array of plain objects with header row as keys
  const rows = XLSX.utils.sheet_to_json<AdoRawRow>(sheet, {
    defval: '',
    raw: false, // keep everything as strings for consistent parsing
  });

  if (rows.length === 0) {
    return { epics: [], orphanTasks: [], allItems: [], warnings: ['The file is empty or has no data rows.'] };
  }

  // Validate headers
  const headers = Object.keys(rows[0]);
  const missingHeaders = validateHeaders(headers);
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
  }

  const warnings: string[] = [];

  // ---------------------------------------------------------------------------
  // First pass: build flat AdoWorkItem list and infer parentId from hierarchy
  // ---------------------------------------------------------------------------
  const allItems: AdoWorkItem[] = [];
  let currentEpicId: number | null = null;
  let currentUserStoryId: number | null = null;

  for (const row of rows) {
    const idRaw = String(row['ID'] ?? '').trim().replace(/"/g, '');
    const id = parseInt(idRaw, 10);

    if (isNaN(id)) {
      warnings.push(`Skipping row with invalid ID: "${row['ID']}"`);
      continue;
    }

    const rawType = (row['Work Item Type'] || '').trim() as WorkItemType;
    if (!ACCEPTED_TYPES.includes(rawType)) {
      warnings.push(`Unknown work item type "${rawType}" on ID ${id} — skipped.`);
      continue;
    }

    const workItemType = rawType;
    const assignedToRaw = row['Assigned To'] || '';

    // Determine parentId based on the hierarchy position in the file
    let parentId: number | null = null;
    if (workItemType === 'Epic') {
      currentEpicId = id;
      currentUserStoryId = null;
      parentId = null;
    } else if (workItemType === 'User Story') {
      currentUserStoryId = id;
      parentId = currentEpicId;
    } else {
      // Task, Bug, Issue
      parentId = currentUserStoryId ?? currentEpicId ?? null;
    }

    const item: AdoWorkItem = {
      id,
      workItemType,
      title: resolveTitle(row),
      assignedTo: assignedToRaw,
      assignedToName: extractName(assignedToRaw),
      state: row['State'] || '',
      startDate: parseDate(row['Start Date']),
      targetDate: parseDate(row['Target Date']),
      originalEstimate: parseEstimate(row['Original Estimate']),
      areaPath: row['Area Path'] ?? '',
      iterationPath: row['Iteration Path'] ?? '',
      parentId,
    };

    allItems.push(item);
  }

  // ---------------------------------------------------------------------------
  // Second pass: build hierarchical structure
  // ---------------------------------------------------------------------------
  const epicMap = new Map<number, Epic>();
  const userStoryMap = new Map<number, UserStory>();
  const orphanTasks: Task[] = [];
  const epics: Epic[] = [];
  let taskOrder = 0;

  // First, seed epics and user stories
  for (const item of allItems) {
    if (item.workItemType === 'Epic') {
      const epic: Epic = { ...(item as AdoWorkItem & { workItemType: 'Epic' }), userStories: [] };
      epicMap.set(epic.id, epic);
      epics.push(epic);
    } else if (item.workItemType === 'User Story') {
      const us: UserStory = { ...(item as AdoWorkItem & { workItemType: 'User Story' }), tasks: [] };
      userStoryMap.set(us.id, us);
      // Attach to its epic
      if (item.parentId !== null && epicMap.has(item.parentId)) {
        epicMap.get(item.parentId)!.userStories.push(us);
      } else {
        // Create a synthetic epic if the parent is missing
        if (item.parentId !== null) {
          warnings.push(`User Story ${item.id} references unknown Epic ${item.parentId}.`);
        }
      }
    }
  }

  // Then, attach tasks/bugs/issues
  for (const item of allItems) {
    if (!TASK_TYPES.includes(item.workItemType as WorkItemType)) continue;

    const startMs = item.startDate ? new Date(item.startDate).getTime() : null;
    const endMs = item.targetDate ? new Date(item.targetDate).getTime() : null;
    const durationDays =
      startMs !== null && endMs !== null
        ? Math.max(1, Math.round((endMs - startMs) / 86_400_000) + 1)
        : 1;

    const task: Task = {
      ...(item as AdoWorkItem & { workItemType: 'Task' | 'Bug' | 'Issue' }),
      durationDays,
      sequenceOrder: taskOrder++,
    };

    if (item.parentId !== null && userStoryMap.has(item.parentId)) {
      userStoryMap.get(item.parentId)!.tasks.push(task);
    } else if (item.parentId !== null && epicMap.has(item.parentId)) {
      // Task directly under an epic (no user story layer)
      warnings.push(`Task ${item.id} is directly under Epic ${item.parentId} (no User Story).`);
      orphanTasks.push(task);
    } else {
      orphanTasks.push(task);
    }
  }

  return { epics, orphanTasks, allItems, warnings };
}
