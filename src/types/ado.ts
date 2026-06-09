// Work Item Types supported by the ADO export
export type WorkItemType = 'Epic' | 'User Story' | 'Task' | 'Bug' | 'Issue';

// Raw row as parsed directly from the CSV/XLSX file.
// Optional columns depend on which ADO query columns are exported.
export interface AdoRawRow {
  ID: string;
  'Work Item Type': string;
  'Title 1': string;
  'Title 2': string;
  'Title 3': string;
  'Assigned To': string;
  State: string;
  'Start Date': string;
  'Target Date': string;
  'Original Estimate': string; // hours, e.g. "8"
  'Area Path'?: string;        // present in some query configurations
  'Iteration Path'?: string;   // present in some query configurations
}

// Normalized work item after parsing
export interface AdoWorkItem {
  id: number;
  workItemType: WorkItemType;
  title: string;
  assignedTo: string;             // Full string e.g. "Name <email>"
  assignedToName: string;         // Extracted display name
  state: string;
  startDate: string | null;       // ISO YYYY-MM-DD
  targetDate: string | null;      // ISO YYYY-MM-DD
  originalEstimate: number | null; // Hours from ADO "Original Estimate" field
  areaPath: string;               // Empty string when column not exported
  iterationPath: string;          // Empty string when column not exported
  parentId: number | null;        // Derived from CSV hierarchy (Epic → US → Task)
}

// Internals used by the Gantt/planner store (specs §3.2)
export interface Task extends AdoWorkItem {
  workItemType: 'Task' | 'Bug' | 'Issue';
  durationDays: number;
  sequenceOrder: number; // within the developer's lane
}

export interface UserStory extends AdoWorkItem {
  workItemType: 'User Story';
  tasks: Task[];
}

export interface Epic extends AdoWorkItem {
  workItemType: 'Epic';
  userStories: UserStory[];
}

export interface DeveloperLane {
  developerName: string;
  tasks: Task[];
}

// Top-level parsed result returned by the parser
export interface ParsedAdoData {
  epics: Epic[];
  orphanTasks: Task[];      // Tasks with no matching parent found
  allItems: AdoWorkItem[];  // Flat list for easy debug/display
  warnings: string[];
}
