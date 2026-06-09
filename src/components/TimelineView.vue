<script setup lang="ts">
import { ref, computed, reactive, watch, onMounted, onUnmounted } from 'vue';
import type { ParsedAdoData, Task, WorkItemType } from '../types/ado';
import { buildExportCsv, downloadCsv } from '../utils/exporter';

const props = defineProps<{ data: ParsedAdoData }>();

// ─── Layout constants ──────────────────────────────────────────────────────
const LABEL_W        = 220; // px – developer name column
const UNSCHEDULED_W  = 160; // px – sticky "unscheduled" panel (between label and canvas)
const DAY_W          = 44;  // px – per calendar day
const ROW_H     = 42;  // px – per task row
const MONTH_ROW = 22;  // px – top header row (month groups)
const DAY_ROW   = 28;  // px – bottom header row (individual days)
const HEADER_H  = MONTH_ROW + DAY_ROW;
const MS_DAY    = 86_400_000;

// Forward buffer so there is always room to drag tasks into the future.
// (Removes the previous short-term "+30 days" hard limit.)
const FUTURE_DAYS = 180;
const PAST_DAYS   = 14;

// ─── Color palette (US → task bar color) ──────────────────────────────────
const PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899',
  '#14b8a6', '#ef4444', '#6366f1', '#f97316', '#06b6d4',
];

// ─── Local editable working copy ───────────────────────────────────────────
// NFR/req-2: all edits live here only. props.data (and the source file) are
// never mutated. We clone the flat task list and mutate startDate / targetDate
// / assignedToName locally.
const localTasks = reactive<Task[]>([]);

function buildLocalTasks(data: ParsedAdoData): Task[] {
  const out: Task[] = [];
  for (const t of data.orphanTasks) out.push({ ...t });
  for (const epic of data.epics)
    for (const us of epic.userStories)
      for (const t of us.tasks) out.push({ ...t });
  return out;
}

// (Re)hydrate the local store whenever a new file is imported.
watch(
  () => props.data,
  (data) => {
    localTasks.splice(0, localTasks.length, ...buildLocalTasks(data));
  },
  { immediate: true, deep: false }
);

// ─── Derived flat task list (reads the editable store) ─────────────────────
const allTasks = computed<Task[]>(() => localTasks);

// ─── Unique developer names (sorted; Unassigned last) ─────────────────────
const allDevelopers = computed<string[]>(() => {
  const set = new Set<string>();
  for (const t of allTasks.value) set.add(t.assignedToName || 'Unassigned');
  return [...set].sort((a, b) =>
    a === 'Unassigned' ? 1 : b === 'Unassigned' ? -1 : a.localeCompare(b)
  );
});

// ─── Unique work item types present in the data ────────────────────────────
const allTypes = computed<WorkItemType[]>(() => {
  const set = new Set<WorkItemType>();
  for (const t of allTasks.value) set.add(t.workItemType);
  return [...set];
});

// ─── Filters ───────────────────────────────────────────────────────────────
const selectedDevs  = ref<Set<string>>(new Set());
const selectedTypes = ref<Set<WorkItemType>>(new Set());
const showDevMenu   = ref(false);
const devMenuRef    = ref<HTMLElement | null>(null);

function toggleDev(dev: string) {
  const s = new Set(selectedDevs.value);
  s.has(dev) ? s.delete(dev) : s.add(dev);
  selectedDevs.value = s;
}

function toggleType(type: WorkItemType) {
  const s = new Set(selectedTypes.value);
  s.has(type) ? s.delete(type) : s.add(type);
  selectedTypes.value = s;
}

function clearFilters() {
  selectedDevs.value  = new Set();
  selectedTypes.value = new Set();
}

// Close the dev dropdown when clicking outside it
function onDocClick(e: MouseEvent) {
  if (showDevMenu.value && devMenuRef.value && !devMenuRef.value.contains(e.target as Node)) {
    showDevMenu.value = false;
  }
}
onMounted(() => document.addEventListener('mousedown', onDocClick));
onUnmounted(() => document.removeEventListener('mousedown', onDocClick));

// ─── Timeline date range ───────────────────────────────────────────────────
// Extra days that get appended when a drag pushes a task past current bounds,
// giving an effectively open-ended (indefinite) forward timeline.
const extraEndDays   = ref(0);
const extraStartDays = ref(0);

function midnight(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

const timelineRange = computed(() => {
  const ms: number[] = [];
  for (const t of allTasks.value) {
    if (t.startDate)  ms.push(new Date(t.startDate).getTime());
    if (t.targetDate) ms.push(new Date(t.targetDate).getTime());
  }
  // Always include "today" so the timeline stays anchored to the present.
  const today = midnight(new Date()).getTime();
  ms.push(today);

  const minMs = Math.min(...ms);
  const maxMs = Math.max(...ms);

  const start = new Date(minMs - (PAST_DAYS + extraStartDays.value) * MS_DAY);
  // Long forward buffer removes the previous short-term future limit.
  const end   = new Date(maxMs + (FUTURE_DAYS + extraEndDays.value) * MS_DAY);
  return { start: midnight(start), end: midnight(end) };
});

const dayHeaders = computed<Date[]>(() => {
  const days: Date[] = [];
  const t0 = timelineRange.value.start.getTime();
  const total = Math.ceil((timelineRange.value.end.getTime() - t0) / MS_DAY);
  for (let i = 0; i < total; i++) days.push(new Date(t0 + i * MS_DAY));
  return days;
});

const timelineWidth = computed(() => dayHeaders.value.length * DAY_W);

// Month groups for the upper header row
const monthGroups = computed(() => {
  const groups: { label: string; count: number }[] = [];
  for (const d of dayHeaders.value) {
    const label = d.toLocaleString('default', { month: 'short', year: 'numeric' });
    if (!groups.length || groups[groups.length - 1].label !== label)
      groups.push({ label, count: 1 });
    else
      groups[groups.length - 1].count++;
  }
  return groups;
});

// Pixel offset of "today" from the left edge (or -1 if out of range)
const todayOffset = computed(() => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - timelineRange.value.start.getTime()) / 86_400_000;
  return diff >= 0 && diff <= dayHeaders.value.length ? diff * DAY_W : -1;
});

// ─── Parent → color map (per US) ──────────────────────────────────────────
const parentColorMap = computed(() => {
  const map = new Map<number | null, string>();
  let idx = 0;
  for (const epic of props.data.epics)
    for (const us of epic.userStories)
      map.set(us.id, PALETTE[idx++ % PALETTE.length]);
  return map;
});

function taskColor(task: Task): string {
  return parentColorMap.value.get(task.parentId) ?? '#71717a';
}

// ─── Lane + row computation ────────────────────────────────────────────────
interface LaneRow {
  task:    Task;
  left:    number; // px from timeline left
  width:   number; // px
  hasDate: boolean;
  color:   string;
}
interface Lane {
  developer:   string;
  datedRows:   LaneRow[]; // tasks with start/target dates → rendered in the canvas
  undatedRows: LaneRow[]; // tasks with no dates → rendered in the sticky panel
}

const filteredTasks = computed(() =>
  allTasks.value.filter(t => {
    const devOk  = selectedDevs.value.size  === 0 || selectedDevs.value.has(t.assignedToName || 'Unassigned');
    const typeOk = selectedTypes.value.size === 0 || selectedTypes.value.has(t.workItemType);
    return devOk && typeOk;
  })
);

const lanes = computed((): Lane[] => {
  const map = new Map<string, LaneRow[]>();
  const t0  = timelineRange.value.start.getTime();

  for (const task of filteredTasks.value) {
    const dev = task.assignedToName || 'Unassigned';
    if (!map.has(dev)) map.set(dev, []);

    const sMs    = task.startDate  ? new Date(task.startDate).getTime()  : null;
    const eMs    = task.targetDate ? new Date(task.targetDate).getTime() : null;
    const hasDate = sMs !== null;

    const left      = hasDate ? Math.max(0, ((sMs! - t0) / MS_DAY) * DAY_W) : 0;
    const daysSpan  = sMs !== null && eMs !== null
      ? Math.max(1, (eMs - sMs) / MS_DAY + 1)
      : Math.max(1, task.durationDays);
    const width = Math.max(DAY_W, daysSpan * DAY_W);

    map.get(dev)!.push({ task, left, width, hasDate, color: taskColor(task) });
  }

  // Keep developer ordering; skip devs filtered out
  return allDevelopers.value
    .filter(dev => map.has(dev))
    .filter(dev => selectedDevs.value.size === 0 || selectedDevs.value.has(dev))
    .map(developer => {
      // Always order rows by Work ID ascending, then split by date presence.
      const all = (map.get(developer) ?? []).sort((a, b) => a.task.id - b.task.id);
      return {
        developer,
        datedRows:   all.filter(r =>  r.hasDate),
        undatedRows: all.filter(r => !r.hasDate),
      };
    });
});

// ─── Legend (one entry per User Story with tasks) ─────────────────────────
const legendItems = computed(() => {
  const items: { id: number; label: string; color: string }[] = [];
  for (const epic of props.data.epics) {
    for (const us of epic.userStories) {
      if (!us.tasks.length) continue;
      items.push({
        id:    us.id,
        label: `#${us.id} ${us.title.length > 40 ? us.title.slice(0, 38) + '…' : us.title}`,
        color: parentColorMap.value.get(us.id) ?? '#71717a',
      });
    }
  }
  return items;
});

// ─── Unscheduled column visibility ───────────────────────────────────────
// Hide the sticky panel entirely when every task in the current view has dates
// (avoids wasting horizontal space once everything is scheduled).
const hasUndatedTasks = computed(() => lanes.value.some(l => l.undatedRows.length > 0));
const unscheduledColW = computed(() => hasUndatedTasks.value ? UNSCHEDULED_W : 0);

// ─── Date helpers ──────────────────────────────────────────────────────────
function isWeekend(d: Date): boolean { const dow = d.getDay(); return dow === 0 || dow === 6; }
function isToday(d: Date): boolean {
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}
function fmtDay(d: Date): string {
  // "M\n9" — narrow weekday + day number in two lines
  return d.toLocaleDateString('en-US', { weekday: 'narrow', day: 'numeric' });
}

// ─── Teleported tooltip state ────────────────────────────────────────────
interface TooltipData {
  task:    Task;
  hasDate: boolean;
  color:   string;
}
const tooltip     = ref<TooltipData | null>(null);
const tooltipStyle = ref({ top: '0px', left: '0px' });

function showTooltip(row: LaneRow, e: MouseEvent) {
  const el   = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const TOOLTIP_H = 180; // rough estimate to flip if near top
  const MARGIN    = 8;

  const top = rect.top > TOOLTIP_H + MARGIN
    ? rect.top - MARGIN          // above the bar
    : rect.bottom + MARGIN;      // below if not enough space on top

  // Keep tooltip within right viewport edge (min-w is 220px)
  const left = Math.min(rect.left, window.innerWidth - 240);

  tooltipStyle.value = {
    top:  top  + 'px',
    left: left + 'px',
  };
  tooltip.value = { task: row.task, hasDate: row.hasDate, color: row.color };
}

function hideTooltip() {
  tooltip.value = null;
}

// ─── Drag & drop (reschedule + reassign) ───────────────────────────────────
const scrollRef = ref<HTMLElement | null>(null);

type DragMode = 'move' | 'resize-start' | 'resize-end';

interface DragState {
  mode:          DragMode;
  taskId:        number;
  pointerId:     number;
  startClientX:  number;
  startClientY:  number;
  origStartMs:   number | null;  // original task start (ms) or null if unscheduled
  origEndMs:     number | null;  // original task target (ms) or null
  durationDays:  number;         // preserved span (move mode)
  dayDelta:      number;         // current horizontal shift in days
  targetDev:     string | null;  // lane under the pointer (vertical reassign)
  origDev:       string;
  moved:         boolean;        // distinguishes a click from a drag
  isUndated:     boolean;        // task had no dates → drag schedules it
  dropDayIndex:  number | null;  // day column under the pointer (undated tasks)
}
const drag = ref<DragState | null>(null);

// Lane DOM refs, registered per swimlane for vertical hit-testing.
const laneEls = new Map<string, HTMLElement>();
function registerLane(dev: string, el: Element | null) {
  if (el) laneEls.set(dev, el as HTMLElement);
  else    laneEls.delete(dev);
}

// Task-bar canvas DOM refs, used to map pointer X → timeline day index
// (required to schedule undated tasks, which have no positional anchor).
const canvasEls = new Map<string, HTMLElement>();
function registerCanvas(dev: string, el: Element | null) {
  if (el) canvasEls.set(dev, el as HTMLElement);
  else    canvasEls.delete(dev);
}

// Convert an absolute clientX to a 0-based day index within the timeline grid.
// Returns null when the pointer is to the left of the canvas (over sticky panels).
function dayIndexFromClientX(clientX: number): number | null {
  // Any lane canvas shares the same horizontal origin, so use the first one.
  const el = canvasEls.values().next().value as HTMLElement | undefined;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const x = clientX - rect.left;
  if (x < 0) return null; // still over a sticky column – no drop target yet
  const idx = Math.floor(x / DAY_W);
  return Math.min(idx, dayHeaders.value.length - 1);
}

// Default span (days) for a task that is being scheduled for the first time.
function defaultSpanDays(task: Task): number {
  if (task.durationDays && task.durationDays > 1) return task.durationDays;
  // Derive a rough span from the Original Estimate (hours → 8h workdays).
  if (task.originalEstimate && task.originalEstimate > 0) {
    return Math.max(1, Math.ceil(task.originalEstimate / 8));
  }
  return 1;
}

function findTask(id: number): Task | undefined {
  return localTasks.find(t => t.id === id);
}

function beginDrag(row: LaneRow, e: PointerEvent, mode: DragMode = 'move') {
  // Only primary button initiates a drag.
  if (e.button !== 0) return;
  e.stopPropagation(); // resize handles must not also trigger a move drag
  hideTooltip();
  const task = row.task;
  const origStartMs = task.startDate  ? new Date(task.startDate).getTime()  : null;
  const origEndMs   = task.targetDate ? new Date(task.targetDate).getTime() : null;

  const isUndated = origStartMs === null;

  drag.value = {
    mode,
    taskId:       task.id,
    pointerId:    e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    origStartMs,
    origEndMs,
    durationDays: isUndated ? defaultSpanDays(task) : Math.max(1, task.durationDays),
    dayDelta:     0,
    targetDev:    null,
    origDev:      task.assignedToName || 'Unassigned',
    moved:        false,
    isUndated,
    dropDayIndex: null,
  };

  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup',   onDragEnd);
}

function laneUnderPointer(clientY: number): string | null {
  for (const [dev, el] of laneEls) {
    const r = el.getBoundingClientRect();
    if (clientY >= r.top && clientY <= r.bottom) return dev;
  }
  return null;
}

function onDragMove(e: PointerEvent) {
  const d = drag.value;
  if (!d) return;

  const dx = e.clientX - d.startClientX;
  const dy = e.clientY - d.startClientY;
  if (!d.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) d.moved = true;

  // Horizontal → whole-day delta
  d.dayDelta = Math.round(dx / DAY_W);

  // Undated task being scheduled → snap to the day column under the pointer.
  if (d.isUndated && d.mode === 'move') {
    d.dropDayIndex = dayIndexFromClientX(e.clientX);
  }

  // Vertical lane reassignment only applies when moving the whole bar.
  d.targetDev = d.mode === 'move' ? laneUnderPointer(e.clientY) : null;
}

function addDays(iso: string, days: number): string {
  const ms = new Date(iso).getTime() + days * MS_DAY;
  return new Date(ms).toISOString().split('T')[0];
}

// Advance an ISO date forward until it lands on a Monday–Friday.
// Saturday (+1) and Sunday (+2) both yield the following Monday.
//
// NOTE: ISO "YYYY-MM-DD" strings are parsed by JavaScript as UTC midnight.
// getUTCDay() must be used here so the day-of-week check matches the UTC
// date rather than the local calendar day (which is one day behind in UTC−N
// timezones and would cause the filter to fire on the wrong days).
function nextBusinessDay(iso: string): string {
  let ms = new Date(iso).getTime();
  let dow = new Date(ms).getUTCDay(); // 0=Sun, 6=Sat  ← UTC, not local
  while (dow === 0 || dow === 6) {
    ms += MS_DAY;
    dow = new Date(ms).getUTCDay();
  }
  return isoFromMs(ms);
}

// ─── Cascade mode (FR-3.3 / Rule 7.4) ────────────────────────────────────
// When ON: after any date change, subsequent tasks for the same developer are
// automatically shifted forward so no two tasks overlap on the same day.
const cascadeMode = ref(false);

/**
 * Propagate a date change forward through the developer's task list.
 *
 * Rules:
 *  • Only tasks that come AFTER `anchorTask` in ID-ascending order are
 *    considered (same order as the visual rows).
 *  • A task is shifted only when it would START on or before the end of the
 *    preceding task (overlap).  Once a gap is found, propagation stops.
 *  • Each shifted task's start is moved to nextBusinessDay(prevEnd + 1 day).
 *    Its target is recalculated preserving `durationDays`, then also snapped
 *    to a business day.
 */
function applyCascade(anchorTask: Task) {
  if (!cascadeMode.value) return;

  const dev = anchorTask.assignedToName || 'Unassigned';

  // Dated tasks for this developer, sorted by ID ascending (matches display).
  const devTasks = localTasks
    .filter(t => (t.assignedToName || 'Unassigned') === dev && t.startDate != null)
    .sort((a, b) => a.id - b.id);

  const anchorIdx = devTasks.findIndex(t => t.id === anchorTask.id);
  if (anchorIdx === -1) return;

  // Walk tasks after the anchor, pushing each one forward as long as overlap.
  let prevEnd = anchorTask.targetDate ?? anchorTask.startDate;

  for (let i = anchorIdx + 1; i < devTasks.length; i++) {
    const t = devTasks[i];
    if (prevEnd == null || t.startDate == null) break;

    // The earliest acceptable start for this task.
    const minStart = nextBusinessDay(addDays(prevEnd, 1));

    if (t.startDate < minStart) {
      // Overlap detected → push this task.
      t.startDate  = minStart;
      t.targetDate = nextBusinessDay(addDays(minStart, Math.max(0, t.durationDays - 1)));
      recomputeDuration(t);
      growRangeFor(t.startDate);
      growRangeFor(t.targetDate!);
    } else {
      // No overlap → cascade stops; remaining tasks are already clear.
      break;
    }

    prevEnd = t.targetDate ?? t.startDate;
  }
}

function onDragEnd() {
  const d = drag.value;
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup',   onDragEnd);
  drag.value = null;
  if (!d || !d.moved) return;

  const task = findTask(d.taskId);
  if (!task) return;

  if (d.mode === 'move') {
    // ── Vertical reassignment (FR-3.4) ──
    if (d.targetDev && d.targetDev !== d.origDev) {
      task.assignedToName = d.targetDev === 'Unassigned' ? '' : d.targetDev;
    }

    if (d.isUndated) {
      // ── Schedule a previously undated task at the drop position ──
      if (d.dropDayIndex !== null) {
        const rawStart  = isoFromMs(timelineRange.value.start.getTime() + d.dropDayIndex * MS_DAY);
        task.startDate  = nextBusinessDay(rawStart);
        task.targetDate = nextBusinessDay(addDays(task.startDate, Math.max(0, d.durationDays - 1)));
        recomputeDuration(task);
        growRangeFor(task.startDate);
        growRangeFor(task.targetDate!);
        applyCascade(task);
      }
    } else if (d.dayDelta !== 0 && task.startDate) {
      // ── Horizontal reschedule (FR-3.1: preserve duration) ──
      const rawStart  = addDays(task.startDate, d.dayDelta);
      task.startDate  = nextBusinessDay(rawStart);
      task.targetDate = nextBusinessDay(addDays(task.startDate, Math.max(0, d.durationDays - 1)));
      recomputeDuration(task);
      growRangeFor(task.startDate);
      growRangeFor(task.targetDate!);
      applyCascade(task);
    }
  } else if (d.mode === 'resize-start' && d.dayDelta !== 0 && d.origStartMs !== null) {
    // ── Resize from left edge: move ONLY the Start Date (FR-3.2) ──
    let newStartMs = d.origStartMs + d.dayDelta * MS_DAY;
    // Clamp so start never passes the target (minimum 1-day span).
    const endMs = d.origEndMs ?? d.origStartMs;
    if (newStartMs > endMs) newStartMs = endMs;
    task.startDate = nextBusinessDay(isoFromMs(newStartMs));
    if (!task.targetDate) task.targetDate = nextBusinessDay(isoFromMs(endMs));
    recomputeDuration(task);
    growRangeFor(task.startDate);
    applyCascade(task);
  } else if (d.mode === 'resize-end' && d.dayDelta !== 0) {
    // ── Resize from right edge: move ONLY the Target Date (FR-3.2) ──
    const baseEndMs = d.origEndMs ?? d.origStartMs;
    if (baseEndMs === null) return;
    let newEndMs = baseEndMs + d.dayDelta * MS_DAY;
    // Clamp so target never precedes the start (minimum 1-day span).
    const startMs = d.origStartMs ?? baseEndMs;
    if (newEndMs < startMs) newEndMs = startMs;
    task.targetDate = nextBusinessDay(isoFromMs(newEndMs));
    if (!task.startDate) task.startDate = nextBusinessDay(isoFromMs(startMs));
    recomputeDuration(task);
    growRangeFor(task.targetDate);
    applyCascade(task);
  }
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString().split('T')[0];
}

// Keep durationDays in sync with the current start/target span.
function recomputeDuration(task: Task) {
  if (task.startDate && task.targetDate) {
    const s = new Date(task.startDate).getTime();
    const e = new Date(task.targetDate).getTime();
    task.durationDays = Math.max(1, Math.round((e - s) / MS_DAY) + 1);
  }
}

// Expand the visible range so a rescheduled task never gets clipped.
function growRangeFor(iso: string) {
  const ms = new Date(iso).getTime();
  const startMs = timelineRange.value.start.getTime();
  const endMs   = timelineRange.value.end.getTime();
  if (ms < startMs) extraStartDays.value += Math.ceil((startMs - ms) / MS_DAY) + PAST_DAYS;
  if (ms > endMs)   extraEndDays.value   += Math.ceil((ms - endMs)   / MS_DAY) + 14;
}

// Live preview offset (px) added to the bar's left during a drag.
function dragOffsetX(taskId: number): number {
  const d = drag.value;
  if (!d || d.taskId !== taskId) return 0;
  // Undated task: snap the bar to the day column under the pointer.
  // (base `left` is 0, so the offset is the absolute drop position.)
  if (d.mode === 'move' && d.isUndated) {
    return d.dropDayIndex !== null ? d.dropDayIndex * DAY_W : 0;
  }
  // Whole-bar move and left-edge resize shift the left position;
  // right-edge resize keeps the left fixed.
  if (d.mode === 'move' || d.mode === 'resize-start') return d.dayDelta * DAY_W;
  return 0;
}

// Live preview width delta (px) during a resize / undated scheduling.
function dragWidthDelta(taskId: number, baseWidth: number): number {
  const d = drag.value;
  if (!d || d.taskId !== taskId) return 0;
  if (d.mode === 'resize-end')   return d.dayDelta * DAY_W;   // grow/shrink right
  if (d.mode === 'resize-start') return -d.dayDelta * DAY_W;  // left edge moves, width inverse
  // Undated task: preview its full scheduled span while dragging.
  if (d.mode === 'move' && d.isUndated && d.dropDayIndex !== null) {
    return d.durationDays * DAY_W - baseWidth;
  }
  return 0;
}

function isDragging(taskId: number): boolean {
  return drag.value?.taskId === taskId && drag.value.moved;
}
function isResizing(taskId: number): boolean {
  const d = drag.value;
  return !!d && d.taskId === taskId && d.moved && d.mode !== 'move';
}

// Human-readable preview of the in-progress drag (shown in the header).
const dragPreview = computed(() => {
  const d = drag.value;
  if (!d || !d.moved) return null;
  const task = findTask(d.taskId);
  if (!task) return null;

  const parts: string[] = [];

  if (d.mode === 'move') {
    if (d.isUndated) {
      if (d.dropDayIndex !== null) {
        const startMs = timelineRange.value.start.getTime() + d.dropDayIndex * MS_DAY;
        const endIso  = isoFromMs(startMs + Math.max(0, d.durationDays - 1) * MS_DAY);
        parts.push(`Schedule ${isoFromMs(startMs)} → ${endIso} (${d.durationDays}d)`);
      } else {
        parts.push('Drop on the timeline to schedule');
      }
    } else if (d.dayDelta !== 0 && d.origStartMs !== null) {
      const newStart = isoFromMs(d.origStartMs + d.dayDelta * MS_DAY);
      const sign = d.dayDelta > 0 ? '+' : '';
      parts.push(`Start ${newStart} (${sign}${d.dayDelta}d)`);
    }
    if (d.targetDev && d.targetDev !== d.origDev) {
      parts.push(`→ ${d.targetDev}`);
    }
  } else {
    // Resize preview: compute clamped start/end and resulting duration.
    let sMs = d.origStartMs;
    let eMs = d.origEndMs ?? d.origStartMs;
    if (d.mode === 'resize-start' && sMs !== null) {
      sMs = Math.min(sMs + d.dayDelta * MS_DAY, eMs ?? sMs);
    } else if (d.mode === 'resize-end' && eMs !== null) {
      eMs = Math.max(eMs + d.dayDelta * MS_DAY, sMs ?? eMs);
    }
    if (sMs !== null && eMs !== null) {
      const dur = Math.max(1, Math.round((eMs - sMs) / MS_DAY) + 1);
      parts.push(`${isoFromMs(sMs)} → ${isoFromMs(eMs)}`);
      parts.push(`(${dur}d)`);
    }
  }

  return parts.length ? { title: task.title, info: parts.join('  ') } : null;
});

// ─── Local edit tracking + reset ───────────────────────────────────────────
const hasLocalEdits = computed(() => {
  const orig = new Map<number, Task>();
  for (const t of props.data.orphanTasks) orig.set(t.id, t);
  for (const epic of props.data.epics)
    for (const us of epic.userStories)
      for (const t of us.tasks) orig.set(t.id, t);

  return localTasks.some(t => {
    const o = orig.get(t.id);
    if (!o) return false;
    return o.startDate !== t.startDate
      || o.targetDate !== t.targetDate
      || (o.assignedToName || '') !== (t.assignedToName || '');
  });
});

function resetEdits() {
  localTasks.splice(0, localTasks.length, ...buildLocalTasks(props.data));
  extraStartDays.value = 0;
  extraEndDays.value   = 0;
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup',   onDragEnd);
});

// ─── CSV export (FR-1.3) ──────────────────────────────────────────────────

/**
 * Number of tasks that will appear in the next export file.
 * - When there are local edits: counts only modified rows (delta export).
 * - When nothing was edited   : counts all tasks (full-state export).
 */
const exportRowCount = computed(() => {
  // Quick-check: if nothing changed return total task count.
  if (!hasLocalEdits.value) return localTasks.length;

  const origMap = new Map<number, Task>();
  for (const t of props.data.orphanTasks) origMap.set(t.id, t);
  for (const epic of props.data.epics)
    for (const us of epic.userStories)
      for (const t of us.tasks) origMap.set(t.id, t);

  return localTasks.filter(t => {
    const o = origMap.get(t.id);
    if (!o) return true;
    return (
      o.startDate                !== t.startDate              ||
      o.targetDate               !== t.targetDate             ||
      (o.assignedToName || '')   !== (t.assignedToName || '')
    );
  }).length;
});

async function triggerExport() {
  const result   = buildExportCsv(localTasks, props.data);
  const dateTag  = new Date().toISOString().split('T')[0];
  const suffix   = result.isFullExport ? 'full' : 'delta';
  const filename = `ado-export-${dateTag}-${suffix}.csv`;
  await downloadCsv(result.csv, filename);
}

// Expose so App.vue header can call triggerExport via a template ref.
defineExpose({ triggerExport, exportRowCount, hasLocalEdits });

// ─── Type badge color ─────────────────────────────────────────────────────
const TYPE_PILL: Record<string, string> = {
  Task:          'border-green-700 text-green-300',
  Bug:           'border-red-700 text-red-300',
  Issue:         'border-orange-700 text-orange-300',
  'User Story':  'border-blue-700 text-blue-300',
  Epic:          'border-purple-700 text-purple-300',
};
function typePill(t: string, active: boolean): string {
  const base = TYPE_PILL[t] ?? 'border-zinc-600 text-zinc-300';
  return active
    ? base.replace('text-', 'bg-').replace('-300', '-900/60') + ' ' + base
    : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300';
}
</script>

<template>
  <div class="flex flex-col h-full bg-zinc-950">

    <!-- ── Filter bar ──────────────────────────────────────────────────── -->
    <div class="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-zinc-800 bg-zinc-900 shrink-0">

      <!-- Developer dropdown -->
      <div ref="devMenuRef" class="relative">
        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
          :class="selectedDevs.size
            ? 'border-blue-600 bg-blue-950/50 text-blue-300'
            : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-500'"
          @click="showDevMenu = !showDevMenu"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
          Developer
          <span v-if="selectedDevs.size" class="px-1.5 rounded-full bg-blue-600 text-white text-[10px] font-bold">
            {{ selectedDevs.size }}
          </span>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-zinc-500 transition-transform" :class="showDevMenu ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        <!-- Dropdown panel -->
        <div
          v-show="showDevMenu"
          class="absolute top-full left-0 mt-1 z-50 min-w-[220px] rounded-xl border border-zinc-700 bg-zinc-800 shadow-2xl shadow-black/60 py-1 overflow-hidden"
        >
          <div class="px-2 py-1 border-b border-zinc-700 flex items-center justify-between">
            <span class="text-[10px] text-zinc-500 uppercase tracking-wide">Filter by developer</span>
            <button
              v-if="selectedDevs.size"
              class="text-[10px] text-blue-400 hover:text-blue-300"
              @click="selectedDevs = new Set()"
            >Clear</button>
          </div>
          <label
            v-for="dev in allDevelopers"
            :key="dev"
            class="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-zinc-700 select-none"
          >
            <input
              type="checkbox"
              class="w-3.5 h-3.5 rounded accent-blue-500"
              :checked="selectedDevs.has(dev)"
              @change="toggleDev(dev)"
            />
            <span class="text-xs text-zinc-200 truncate">{{ dev }}</span>
          </label>
        </div>
      </div>

      <!-- Type pill toggles -->
      <div class="flex items-center gap-1">
        <span class="text-xs text-zinc-600 mr-1">Type:</span>
        <button
          v-for="type in allTypes"
          :key="type"
          type="button"
          class="px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors"
          :class="typePill(type, selectedTypes.has(type))"
          @click="toggleType(type)"
        >
          {{ type }}
        </button>
      </div>

      <!-- Cascade mode toggle (FR-3.3 / Rule 7.4) -->
      <button
        type="button"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
        :class="cascadeMode
          ? 'border-emerald-600 bg-emerald-950/50 text-emerald-300'
          : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'"
        :title="cascadeMode
          ? 'Cascade ON — subsequent tasks shift automatically to prevent overlaps'
          : 'Cascade OFF — click to enable automatic task shifting'"
        @click="cascadeMode = !cascadeMode"
      >
        <!-- chain-link icon -->
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
        </svg>
        Cascade
        <!-- status dot -->
        <span
          class="w-1.5 h-1.5 rounded-full"
          :class="cascadeMode ? 'bg-emerald-400' : 'bg-zinc-600'"
        />
      </button>

      <!-- Clear all filters -->
      <button
        v-if="selectedDevs.size || selectedTypes.size"
        type="button"
        class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 transition-colors"
        @click="clearFilters"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        Clear filters
      </button>

      <!-- Reset local edits -->
      <button
        v-if="hasLocalEdits"
        type="button"
        class="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-300 bg-amber-950/40 border border-amber-800/60 hover:bg-amber-900/50 transition-colors"
        title="Discard all local date/assignment changes (source file is never modified)"
        @click="resetEdits"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
        </svg>
        Reset changes
      </button>

      <!-- Export CSV (FR-1.3) -->
      <button
        type="button"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
        :class="hasLocalEdits
          ? 'border-teal-600 bg-teal-950/50 text-teal-300 hover:bg-teal-900/60'
          : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300'"
        :title="hasLocalEdits
          ? `Export ${exportRowCount} modified task${exportRowCount !== 1 ? 's' : ''} to CSV`
          : 'Export all tasks to CSV (no changes yet)'"
        @click="triggerExport"
      >
        <!-- download icon -->
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Export CSV
        <!-- change count badge -->
        <span
          v-if="hasLocalEdits"
          class="px-1.5 rounded-full text-[10px] font-bold text-white bg-teal-600"
        >{{ exportRowCount }}</span>
      </button>

      <!-- Stats pill -->
      <div class="flex items-center gap-3 text-xs text-zinc-500" :class="hasLocalEdits ? 'ml-3' : 'ml-auto'">
        <span>{{ filteredTasks.length }} item{{ filteredTasks.length !== 1 ? 's' : '' }}</span>
        <span class="text-zinc-700">·</span>
        <span>{{ lanes.length }} developer{{ lanes.length !== 1 ? 's' : '' }}</span>
      </div>
    </div>

    <!-- ── Drag hint / live preview ─────────────────────────────────────── -->
    <div
      v-if="dragPreview"
      class="flex items-center gap-2 px-4 py-1 bg-blue-950/50 border-b border-blue-900/50 text-xs shrink-0"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
      <span class="text-zinc-300 font-medium truncate max-w-[40%]">{{ dragPreview.title }}</span>
      <span class="text-blue-300 font-mono">{{ dragPreview.info }}</span>
    </div>

    <!-- ── Legend ──────────────────────────────────────────────────────── -->
    <div
      v-if="legendItems.length"
      class="flex items-center gap-4 px-4 py-1.5 border-b border-zinc-800/70 bg-zinc-900/60 overflow-x-auto shrink-0"
      style="scrollbar-width: none;"
    >
      <span class="text-[10px] text-zinc-600 uppercase tracking-wide shrink-0">Legend</span>
      <div v-for="item in legendItems" :key="item.id" class="flex items-center gap-1.5 shrink-0">
        <div class="w-2 h-2 rounded-sm" :style="{ backgroundColor: item.color }" />
        <span class="text-[11px] text-zinc-400 whitespace-nowrap">{{ item.label }}</span>
      </div>
    </div>

    <!-- ── Timeline ────────────────────────────────────────────────────── -->
    <div
      ref="scrollRef"
      class="flex-1 overflow-auto"
      :class="drag ? 'select-none' : ''"
      style="scrollbar-color: #3f3f46 transparent;"
    >
      <!-- Content wider than viewport → enables horizontal scroll in this container -->
      <div :style="{ minWidth: (LABEL_W + unscheduledColW + timelineWidth) + 'px' }">

        <!-- ── Sticky header ─────────────────────────────────────────── -->
        <div
          class="flex sticky top-0 z-20 bg-zinc-900 border-b border-zinc-700"
          :style="{ height: HEADER_H + 'px' }"
        >
          <!-- Corner cell (sticky in both axes via stacking) -->
          <div
            class="sticky left-0 z-30 bg-zinc-900 border-r border-zinc-700 flex items-end px-3 pb-1.5"
            :style="{ width: LABEL_W + 'px', minWidth: LABEL_W + 'px', flexShrink: 0 }"
          >
            <span class="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Developer</span>
          </div>

          <!-- Unscheduled column header (sticky; only rendered when there are undated tasks) -->
          <div
            v-if="hasUndatedTasks"
            class="sticky z-20 bg-zinc-900 border-r border-zinc-700/60 flex items-end px-2 pb-1.5"
            :style="{ left: LABEL_W + 'px', width: UNSCHEDULED_W + 'px', minWidth: UNSCHEDULED_W + 'px', flexShrink: 0 }"
          >
            <span class="text-[10px] text-zinc-600 uppercase tracking-wider font-medium">Unscheduled</span>
          </div>

          <!-- Date header columns -->
          <div :style="{ width: timelineWidth + 'px', flexShrink: 0 }">
            <!-- Month row -->
            <div class="flex" :style="{ height: MONTH_ROW + 'px' }">
              <div
                v-for="(g, gi) in monthGroups"
                :key="gi"
                class="border-r border-zinc-800 px-2 flex items-center overflow-hidden"
                :style="{ width: (g.count * DAY_W) + 'px', flexShrink: 0 }"
              >
                <span class="text-[10px] text-zinc-400 font-medium truncate">{{ g.label }}</span>
              </div>
            </div>
            <!-- Day row -->
            <div class="flex" :style="{ height: DAY_ROW + 'px' }">
              <div
                v-for="(d, di) in dayHeaders"
                :key="di"
                class="border-r border-zinc-800/80 flex items-center justify-center overflow-hidden shrink-0"
                :style="{ width: DAY_W + 'px' }"
                :class="[
                  isWeekend(d) ? 'bg-zinc-800/40 text-zinc-600' : 'text-zinc-500',
                  isToday(d)   ? '!text-blue-400 font-bold' : '',
                ]"
              >
                <span class="text-[10px] leading-none text-center select-none whitespace-pre">{{ fmtDay(d) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ── Developer swimlane rows ───────────────────────────────── -->
        <div
          v-for="lane in lanes"
          :key="lane.developer"
          :ref="(el) => registerLane(lane.developer, el as Element | null)"
          class="flex border-b border-zinc-800 transition-colors"
          :class="drag && drag.moved && drag.targetDev === lane.developer && drag.origDev !== lane.developer
            ? 'bg-blue-950/30 ring-1 ring-inset ring-blue-500/40'
            : ''"
          :style="{ minHeight: Math.max(1, Math.max(lane.datedRows.length, lane.undatedRows.length)) * ROW_H + 'px' }"
        >

          <!-- Sticky developer name cell -->
          <div
            class="sticky left-0 z-10 border-r border-zinc-700 px-3 py-2 flex flex-col justify-start gap-0.5 transition-colors"
            :class="drag && drag.moved && drag.targetDev === lane.developer && drag.origDev !== lane.developer
              ? 'bg-blue-950/60'
              : 'bg-zinc-900'"
            :style="{ width: LABEL_W + 'px', minWidth: LABEL_W + 'px', flexShrink: 0 }"
          >
            <span
              class="text-sm font-medium text-zinc-200 leading-snug truncate"
              :style="{ maxWidth: (LABEL_W - 24) + 'px' }"
              :title="lane.developer"
            >{{ lane.developer }}</span>
            <span class="text-[10px] text-zinc-600">
              {{ lane.datedRows.length + lane.undatedRows.length }} task{{ (lane.datedRows.length + lane.undatedRows.length) !== 1 ? 's' : '' }}
            </span>
          </div>

          <!-- ── Sticky unscheduled panel ──────────────────────────────── -->
          <!-- Chips are always visible; the user drags them right to schedule -->
          <div
            v-if="hasUndatedTasks"
            class="sticky z-10 border-r border-zinc-700/60 bg-zinc-950 flex flex-col justify-start py-1 gap-0.5 overflow-y-auto"
            :style="{ left: LABEL_W + 'px', width: UNSCHEDULED_W + 'px', minWidth: UNSCHEDULED_W + 'px', flexShrink: 0 }"
            style="scrollbar-width: none;"
          >
            <div
              v-for="row in lane.undatedRows"
              :key="row.task.id"
              class="mx-1 touch-none cursor-grab group/chip flex items-center rounded overflow-hidden"
              :class="isDragging(row.task.id) ? 'opacity-30 cursor-grabbing' : 'hover:brightness-110'"
              :style="{
                height: (ROW_H - 14) + 'px',
                backgroundColor: row.color + '18',
                border: `1px dashed ${row.color}40`,
              }"
              @pointerdown="beginDrag(row, $event, 'move')"
              @mouseenter="!drag && showTooltip(row, $event)"
              @mouseleave="hideTooltip"
            >
              <!-- Left color accent -->
              <div class="w-[3px] self-stretch rounded-l shrink-0" :style="{ backgroundColor: row.color + '80' }" />
              <!-- Title -->
              <span class="mx-1.5 text-[11px] font-medium text-zinc-400 truncate flex-1 pointer-events-none select-none">
                {{ row.task.title }}
              </span>
              <!-- Drag hint icon -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-3 h-3 shrink-0 mr-1.5 text-zinc-600 group-hover/chip:text-blue-400 transition-colors pointer-events-none"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </div>
            <!-- Empty placeholder so the drop zone always shows something -->
            <div
              v-if="lane.undatedRows.length === 0"
              class="mx-1 flex items-center justify-center rounded"
              :style="{ height: (ROW_H - 14) + 'px' }"
            >
              <span class="text-[10px] text-zinc-700 italic">—</span>
            </div>
          </div>

          <!-- Task bar canvas -->
          <div
            :ref="(el) => registerCanvas(lane.developer, el as Element | null)"
            :style="{
              width: timelineWidth + 'px',
              height: Math.max(1, Math.max(lane.datedRows.length, lane.undatedRows.length)) * ROW_H + 'px',
              flexShrink: 0,
            }"
            class="relative overflow-hidden"
          >
            <!-- Background: weekend tinting + day columns -->
            <template v-for="(d, di) in dayHeaders" :key="'bg-' + di">
              <div
                v-if="isWeekend(d)"
                class="absolute top-0 bottom-0 bg-zinc-800/25"
                :style="{ left: (di * DAY_W) + 'px', width: DAY_W + 'px' }"
              />
            </template>

            <!-- Weekly vertical grid lines -->
            <template v-for="(_d, di) in dayHeaders" :key="'gl-' + di">
              <div
                v-if="di % 7 === 0"
                class="absolute top-0 bottom-0 w-px bg-zinc-700/30"
                :style="{ left: (di * DAY_W) + 'px' }"
              />
            </template>

            <!-- Today marker -->
            <div
              v-if="todayOffset >= 0"
              class="absolute top-0 bottom-0 w-0.5 bg-blue-500/60 z-10"
              :style="{ left: todayOffset + 'px' }"
            />

            <!-- Task bars (dated tasks only; undated tasks are in the sticky panel) -->
            <div
              v-for="(row, ri) in lane.datedRows"
              :key="row.task.id"
              class="absolute touch-none group/bar"
              :class="[
                'cursor-grab',
                isDragging(row.task.id) ? 'z-30 cursor-grabbing' : '',
              ]"
              :style="{
                top:    (ri * ROW_H + 7) + 'px',
                left:   (row.left + dragOffsetX(row.task.id)) + 'px',
                width:  Math.max(DAY_W - 3, row.width - 3 + dragWidthDelta(row.task.id, row.width - 3)) + 'px',
                height: (ROW_H - 14) + 'px',
                transition: isDragging(row.task.id) ? 'none' : 'left 0.12s ease, width 0.12s ease',
              }"
              @pointerdown="beginDrag(row, $event, 'move')"
              @mouseenter="!drag && showTooltip(row, $event)"
              @mouseleave="hideTooltip"
            >
              <!-- Bar body -->
              <div
                class="w-full h-full rounded flex items-center overflow-hidden relative"
                :class="isDragging(row.task.id) ? 'shadow-lg shadow-black/50 ring-1 ring-white/20' : ''"
                :style="{
                  backgroundColor: row.color + (row.hasDate ? '20' : '0c'),
                  border: `1px ${row.hasDate ? 'solid' : 'dashed'} ${row.color}${row.hasDate ? '70' : '35'}`,
                }"
              >
                <!-- Left color accent -->
                <div
                  class="absolute left-0 top-0 bottom-0 w-[3px] rounded-l pointer-events-none"
                  :style="{ backgroundColor: row.color + (row.hasDate ? '' : '60') }"
                />
                <!-- Task title -->
                <span
                  class="ml-2 pl-1 text-xs font-medium truncate flex-1 pointer-events-none"
                  :class="row.hasDate ? 'text-zinc-100' : 'text-zinc-500'"
                >
                  {{ row.task.title }}
                </span>
                <!-- No-date badge → hints that dragging schedules the task -->
                <span
                  v-if="!row.hasDate"
                  class="shrink-0 mr-1.5 text-[9px] rounded px-1 pointer-events-none flex items-center gap-0.5
                         border transition-colors"
                  :class="isDragging(row.task.id)
                    ? 'text-blue-300 bg-blue-950/60 border-blue-700'
                    : 'text-zinc-500 bg-zinc-800 border-zinc-700 group-hover/bar:text-blue-300 group-hover/bar:border-blue-700/60'"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
                  </svg>
                  {{ isDragging(row.task.id) ? 'Scheduling…' : 'Drag to schedule' }}
                </span>
              </div>

              <!-- Resize handles (FR-3.2): only on dated tasks -->
              <template v-if="row.hasDate">
                <!-- Left edge → Start Date -->
                <div
                  class="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize flex items-center justify-center
                         opacity-0 group-hover/bar:opacity-100 transition-opacity"
                  :class="isResizing(row.task.id) ? 'opacity-100' : ''"
                  title="Drag to change Start Date"
                  @pointerdown="beginDrag(row, $event, 'resize-start')"
                  @mouseenter="hideTooltip"
                >
                  <div class="h-3/5 w-[3px] rounded-full bg-white/70" />
                </div>
                <!-- Right edge → Target Date -->
                <div
                  class="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize flex items-center justify-center
                         opacity-0 group-hover/bar:opacity-100 transition-opacity"
                  :class="isResizing(row.task.id) ? 'opacity-100' : ''"
                  title="Drag to change Target Date"
                  @pointerdown="beginDrag(row, $event, 'resize-end')"
                  @mouseenter="hideTooltip"
                >
                  <div class="h-3/5 w-[3px] rounded-full bg-white/70" />
                </div>
              </template>
            </div>

            <!-- Ghost bar: shows where the undated task will land while dragging -->
            <div
              v-if="drag?.isUndated && drag.moved && drag.dropDayIndex !== null
                    && (drag.targetDev ?? drag.origDev) === lane.developer"
              class="absolute pointer-events-none z-40 rounded"
              :style="{
                top:    (lane.datedRows.filter(r => r.task.id < drag!.taskId).length * ROW_H + 7) + 'px',
                left:   (drag.dropDayIndex * DAY_W) + 'px',
                width:  Math.max(DAY_W - 3, drag.durationDays * DAY_W - 3) + 'px',
                height: (ROW_H - 14) + 'px',
              }"
            >
              <div
                class="w-full h-full rounded flex items-center px-2 gap-1.5 overflow-hidden"
                style="background: rgb(37 99 235 / 0.18); border: 1px dashed rgb(96 165 250 / 0.7);"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 9v7.5" />
                </svg>
                <span class="text-[11px] font-medium text-blue-300 truncate pointer-events-none select-none">
                  {{ findTask(drag!.taskId)?.title }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state when filters exclude everything -->
        <div
          v-if="lanes.length === 0"
          class="flex flex-col items-center justify-center text-center py-16 px-4"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-10 h-10 text-zinc-700 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
          </svg>
          <p class="text-sm text-zinc-500">No items match the current filters.</p>
          <button
            type="button"
            class="mt-3 text-xs text-blue-400 hover:text-blue-300 underline"
            @click="clearFilters"
          >Clear filters</button>
        </div>

      </div>
    </div>

    <!-- ── Teleported tooltip (renders at <body> level, never clipped) ── -->
    <Teleport to="body">
      <div
        v-if="tooltip"
        class="fixed z-[9999] pointer-events-none"
        :style="tooltipStyle"
      >
        <!-- Arrow-less card that appears above or below the bar -->
        <div
          class="rounded-xl border border-zinc-600 bg-zinc-800/95 shadow-2xl shadow-black/70 backdrop-blur-sm p-3 min-w-[220px] max-w-xs"
          :style="{ borderTopColor: tooltip.color }"
          style="border-top-width: 2px;"
        >
          <!-- Color accent + title -->
          <div class="flex items-start gap-2 mb-2">
            <div class="w-2 h-2 rounded-sm mt-0.5 shrink-0" :style="{ backgroundColor: tooltip.color }" />
            <p class="text-xs font-semibold text-zinc-100 leading-snug">{{ tooltip.task.title }}</p>
          </div>
          <div class="space-y-0.5 pl-4">
            <p class="text-[11px] text-zinc-400">
              <span class="text-zinc-600">Type · ID: </span>
              {{ tooltip.task.workItemType }} · #{{ tooltip.task.id }}
            </p>
            <p class="text-[11px] text-zinc-400">
              <span class="text-zinc-600">Assigned: </span>
              {{ tooltip.task.assignedToName || '—' }}
            </p>
            <p class="text-[11px] text-zinc-400">
              <span class="text-zinc-600">State: </span>
              {{ tooltip.task.state || '—' }}
            </p>
            <p class="text-[11px] text-zinc-400">
              <span class="text-zinc-600">Start: </span>
              {{ tooltip.task.startDate ?? 'Unscheduled' }}
            </p>
            <p class="text-[11px] text-zinc-400">
              <span class="text-zinc-600">Target: </span>
              {{ tooltip.task.targetDate ?? 'Unscheduled' }}
            </p>
            <p v-if="tooltip.hasDate" class="text-[11px] text-zinc-400">
              <span class="text-zinc-600">Duration: </span>
              {{ tooltip.task.durationDays }} day{{ tooltip.task.durationDays !== 1 ? 's' : '' }}
            </p>
            <p v-if="tooltip.task.originalEstimate !== null" class="text-[11px] text-zinc-400">
              <span class="text-zinc-600">Original Estimate: </span>
              <span class="text-sky-400 font-medium">{{ tooltip.task.originalEstimate }}h</span>
              <span class="text-zinc-500 font-medium"> ({{ Math.ceil(tooltip.task.originalEstimate! / 8) }}d)</span>
            </p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
