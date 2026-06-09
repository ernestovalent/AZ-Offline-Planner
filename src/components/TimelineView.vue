<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { ParsedAdoData, Task, WorkItemType } from '../types/ado';

const props = defineProps<{ data: ParsedAdoData }>();

// ─── Layout constants ──────────────────────────────────────────────────────
const LABEL_W   = 220; // px – developer name column
const DAY_W     = 44;  // px – per calendar day
const ROW_H     = 42;  // px – per task row
const MONTH_ROW = 22;  // px – top header row (month groups)
const DAY_ROW   = 28;  // px – bottom header row (individual days)
const HEADER_H  = MONTH_ROW + DAY_ROW;

// ─── Color palette (US → task bar color) ──────────────────────────────────
const PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899',
  '#14b8a6', '#ef4444', '#6366f1', '#f97316', '#06b6d4',
];

// ─── Derived flat task list ────────────────────────────────────────────────
const allTasks = computed<Task[]>(() => {
  const out: Task[] = [...props.data.orphanTasks];
  for (const epic of props.data.epics)
    for (const us of epic.userStories)
      out.push(...us.tasks);
  return out;
});

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
const timelineRange = computed(() => {
  const ms: number[] = [];
  for (const t of allTasks.value) {
    if (t.startDate)  ms.push(new Date(t.startDate).getTime());
    if (t.targetDate) ms.push(new Date(t.targetDate).getTime());
  }
  const PAD = 7 * 86_400_000;
  if (!ms.length) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    return { start: new Date(now.getTime() - PAD), end: new Date(now.getTime() + 30 * 86_400_000) };
  }
  return {
    start: new Date(Math.min(...ms) - PAD),
    end:   new Date(Math.max(...ms) + PAD),
  };
});

const dayHeaders = computed<Date[]>(() => {
  const days: Date[] = [];
  const t0 = timelineRange.value.start.getTime();
  const total = Math.ceil((timelineRange.value.end.getTime() - t0) / 86_400_000);
  for (let i = 0; i < total; i++) days.push(new Date(t0 + i * 86_400_000));
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
  developer: string;
  rows:      LaneRow[];
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

    const left      = hasDate ? Math.max(0, ((sMs! - t0) / 86_400_000) * DAY_W) : 0;
    const daysSpan  = sMs !== null && eMs !== null
      ? Math.max(1, (eMs - sMs) / 86_400_000 + 1)
      : Math.max(1, task.durationDays);
    const width = Math.max(DAY_W, daysSpan * DAY_W);

    map.get(dev)!.push({ task, left, width, hasDate, color: taskColor(task) });
  }

  // Keep developer ordering; skip devs filtered out
  return allDevelopers.value
    .filter(dev => map.has(dev))
    .filter(dev => selectedDevs.value.size === 0 || selectedDevs.value.has(dev))
    .map(developer => ({
      developer,
      rows: (map.get(developer) ?? []).sort((a, b) => {
        // Dated tasks first, then sort by start position
        if (a.hasDate && !b.hasDate) return -1;
        if (!a.hasDate && b.hasDate) return  1;
        return a.left - b.left;
      }),
    }));
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

      <!-- Stats pill -->
      <div class="ml-auto flex items-center gap-3 text-xs text-zinc-500">
        <span>{{ filteredTasks.length }} item{{ filteredTasks.length !== 1 ? 's' : '' }}</span>
        <span class="text-zinc-700">·</span>
        <span>{{ lanes.length }} developer{{ lanes.length !== 1 ? 's' : '' }}</span>
      </div>
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
    <div class="flex-1 overflow-auto" style="scrollbar-color: #3f3f46 transparent;">
      <!-- Content wider than viewport → enables horizontal scroll in this container -->
      <div :style="{ minWidth: (LABEL_W + timelineWidth) + 'px' }">

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
          class="flex border-b border-zinc-800"
          :style="{ minHeight: Math.max(1, lane.rows.length) * ROW_H + 'px' }"
        >

          <!-- Sticky developer name cell -->
          <div
            class="sticky left-0 z-10 bg-zinc-900 border-r border-zinc-700 px-3 py-2 flex flex-col justify-start gap-0.5"
            :style="{ width: LABEL_W + 'px', minWidth: LABEL_W + 'px', flexShrink: 0 }"
          >
            <span
              class="text-sm font-medium text-zinc-200 leading-snug truncate"
              :style="{ maxWidth: (LABEL_W - 24) + 'px' }"
              :title="lane.developer"
            >{{ lane.developer }}</span>
            <span class="text-[10px] text-zinc-600">
              {{ lane.rows.length }} task{{ lane.rows.length !== 1 ? 's' : '' }}
            </span>
          </div>

          <!-- Task bar canvas -->
          <div
            :style="{
              width: timelineWidth + 'px',
              height: Math.max(1, lane.rows.length) * ROW_H + 'px',
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

            <!-- Task bars -->
            <div
              v-for="(row, ri) in lane.rows"
              :key="row.task.id"
              class="absolute cursor-default"
              :style="{
                top:    (ri * ROW_H + 7) + 'px',
                left:   row.left + 'px',
                width:  (row.width - 3) + 'px',
                height: (ROW_H - 14) + 'px',
              }"
              @mouseenter="showTooltip(row, $event)"
              @mouseleave="hideTooltip"
            >
              <!-- Bar body -->
              <div
                class="w-full h-full rounded flex items-center overflow-hidden relative"
                :style="{
                  backgroundColor: row.color + (row.hasDate ? '20' : '0c'),
                  border: `1px ${row.hasDate ? 'solid' : 'dashed'} ${row.color}${row.hasDate ? '70' : '35'}`,
                }"
              >
                <!-- Left color accent -->
                <div
                  class="absolute left-0 top-0 bottom-0 w-[3px] rounded-l"
                  :style="{ backgroundColor: row.color + (row.hasDate ? '' : '60') }"
                />
                <!-- Task title -->
                <span
                  class="ml-2 pl-1 text-xs font-medium truncate flex-1"
                  :class="row.hasDate ? 'text-zinc-100' : 'text-zinc-500'"
                >
                  {{ row.task.title }}
                </span>
                <!-- No-date badge -->
                <span
                  v-if="!row.hasDate"
                  class="shrink-0 mr-1.5 text-[9px] text-zinc-600 bg-zinc-800 border border-zinc-700 rounded px-1"
                >No date</span>
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
            </p>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
