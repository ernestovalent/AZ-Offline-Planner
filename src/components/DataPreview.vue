<script setup lang="ts">
import type { ParsedAdoData } from '../types/ado';

defineProps<{
  data: ParsedAdoData;
  fileName: string;
}>();

const emit = defineEmits<{
  (e: 'go-to-timeline'): void;
}>();

const TYPE_BADGE: Record<string, string> = {
  Epic:        'bg-purple-900/70 text-purple-300 border-purple-700',
  'User Story':'bg-blue-900/70 text-blue-300 border-blue-700',
  Task:        'bg-green-900/70 text-green-300 border-green-700',
  Bug:         'bg-red-900/70 text-red-300 border-red-700',
  Issue:       'bg-orange-900/70 text-orange-300 border-orange-700',
};

const STATE_BADGE: Record<string, string> = {
  Active:            'bg-emerald-900/60 text-emerald-300',
  New:               'bg-zinc-700 text-zinc-300',
  'En construcción': 'bg-yellow-900/60 text-yellow-300',
  'Análisis':        'bg-sky-900/60 text-sky-300',
};

function typeBadge(type: string): string {
  return TYPE_BADGE[type] ?? 'bg-zinc-700 text-zinc-300 border-zinc-600';
}

function stateBadge(state: string): string {
  return STATE_BADGE[state] ?? 'bg-zinc-700/60 text-zinc-300';
}

function totalTasks(data: ParsedAdoData): number {
  let n = data.orphanTasks.length;
  for (const epic of data.epics) {
    for (const us of epic.userStories) {
      n += us.tasks.length;
    }
  }
  return n;
}

function totalUserStories(data: ParsedAdoData): number {
  return data.epics.reduce((s, e) => s + e.userStories.length, 0);
}
</script>

<template>
  <div class="w-full space-y-6">
    <!-- Summary bar -->
    <div class="flex flex-wrap items-center gap-4 rounded-xl bg-zinc-800 border border-zinc-700 px-5 py-4">
      <div class="flex-1 min-w-0">
        <p class="text-xs text-zinc-400 uppercase tracking-wide">File</p>
        <p class="text-sm font-medium text-zinc-100 truncate">{{ fileName }}</p>
      </div>
      <div class="text-center px-4">
        <p class="text-2xl font-bold text-purple-400">{{ data.epics.length }}</p>
        <p class="text-xs text-zinc-400 uppercase">Epics</p>
      </div>
      <div class="text-center px-4">
        <p class="text-2xl font-bold text-blue-400">{{ totalUserStories(data) }}</p>
        <p class="text-xs text-zinc-400 uppercase">User Stories</p>
      </div>
      <div class="text-center px-4">
        <p class="text-2xl font-bold text-green-400">{{ totalTasks(data) }}</p>
        <p class="text-xs text-zinc-400 uppercase">Tasks / Bugs</p>
      </div>
      <div class="text-center px-4">
        <p class="text-2xl font-bold text-zinc-200">{{ data.allItems.length }}</p>
        <p class="text-xs text-zinc-400 uppercase">Total Items</p>
      </div>
    </div>

    <!-- Warnings -->
    <div v-if="data.warnings.length" class="rounded-lg bg-yellow-950/50 border border-yellow-700 px-4 py-3 space-y-1">
      <p class="text-xs font-semibold text-yellow-400 uppercase tracking-wide">Warnings</p>
      <ul class="list-disc list-inside text-sm text-yellow-300 space-y-0.5">
        <li v-for="(w, i) in data.warnings" :key="i">{{ w }}</li>
      </ul>
    </div>

    <!-- Hierarchical tree -->
    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-zinc-400 uppercase tracking-wide">Hierarchy</h2>

      <div v-for="epic in data.epics" :key="epic.id" class="rounded-xl border border-purple-800/50 bg-zinc-900 overflow-hidden">
        <!-- Epic header -->
        <div class="flex items-center gap-3 px-4 py-3 bg-purple-950/40 border-b border-purple-800/40">
          <span class="text-xs font-medium px-2 py-0.5 rounded border" :class="typeBadge('Epic')">Epic</span>
          <span class="text-xs text-zinc-500">#{{ epic.id }}</span>
          <span class="text-sm font-semibold text-zinc-100 flex-1">{{ epic.title }}</span>
          <span class="text-xs px-2 py-0.5 rounded" :class="stateBadge(epic.state)">{{ epic.state }}</span>
          <span class="text-xs text-zinc-500">{{ epic.assignedToName }}</span>
        </div>

        <!-- User Stories -->
        <div v-for="us in epic.userStories" :key="us.id" class="border-b border-zinc-800 last:border-b-0">
          <div class="flex items-center gap-3 px-4 py-2.5 bg-blue-950/20 border-b border-blue-900/30">
            <span class="w-4 shrink-0"></span>
            <span class="text-xs font-medium px-2 py-0.5 rounded border" :class="typeBadge('User Story')">US</span>
            <span class="text-xs text-zinc-500">#{{ us.id }}</span>
            <span class="text-sm text-zinc-200 flex-1">{{ us.title }}</span>
            <span class="text-xs px-2 py-0.5 rounded" :class="stateBadge(us.state)">{{ us.state }}</span>
            <span class="text-xs text-zinc-500">{{ us.assignedToName }}</span>
          </div>

          <!-- Tasks -->
          <div
            v-for="task in us.tasks"
            :key="task.id"
            class="flex items-center gap-3 px-4 py-2 border-b border-zinc-800/60 last:border-b-0 hover:bg-zinc-800/40 transition-colors"
          >
            <span class="w-8 shrink-0"></span>
            <span class="text-xs font-medium px-2 py-0.5 rounded border" :class="typeBadge(task.workItemType)">
              {{ task.workItemType }}
            </span>
            <span class="text-xs text-zinc-500">#{{ task.id }}</span>
            <span class="text-sm text-zinc-300 flex-1 truncate">{{ task.title }}</span>
            <span class="text-xs px-2 py-0.5 rounded" :class="stateBadge(task.state)">{{ task.state }}</span>
            <span class="text-xs text-zinc-500 w-28 text-right shrink-0">{{ task.assignedToName }}</span>
            <span class="text-xs text-zinc-600 w-24 text-right shrink-0">
              {{ task.startDate ?? '—' }}
            </span>
            <span class="text-xs text-zinc-600 w-24 text-right shrink-0">
              {{ task.targetDate ?? '—' }}
            </span>
            <span
              v-if="task.originalEstimate !== null"
              class="shrink-0 ml-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-900/50 border border-sky-800 text-sky-300 tabular-nums"
              title="Original Estimate"
            >
              {{ task.originalEstimate }}h
            </span>
          </div>
        </div>

        <!-- Epic with no user stories -->
        <div v-if="epic.userStories.length === 0" class="px-4 py-3 text-xs text-zinc-600 italic">
          No User Stories found under this Epic.
        </div>
      </div>

      <!-- Orphan tasks -->
      <div v-if="data.orphanTasks.length" class="rounded-xl border border-zinc-700 bg-zinc-900 overflow-hidden">
        <div class="px-4 py-3 bg-zinc-800 border-b border-zinc-700">
          <span class="text-sm font-semibold text-zinc-300">Unassigned / Orphan Tasks</span>
        </div>
        <div
          v-for="task in data.orphanTasks"
          :key="task.id"
          class="flex items-center gap-3 px-4 py-2 border-b border-zinc-800 last:border-b-0 hover:bg-zinc-800/40 transition-colors"
        >
          <span class="text-xs font-medium px-2 py-0.5 rounded border" :class="typeBadge(task.workItemType)">
            {{ task.workItemType }}
          </span>
          <span class="text-xs text-zinc-500">#{{ task.id }}</span>
          <span class="text-sm text-zinc-300 flex-1 truncate">{{ task.title }}</span>
          <span class="text-xs px-2 py-0.5 rounded" :class="stateBadge(task.state)">{{ task.state }}</span>
          <span class="text-xs text-zinc-500">{{ task.assignedToName }}</span>
          <span class="text-xs text-zinc-600">{{ task.startDate ?? '—' }} → {{ task.targetDate ?? '—' }}</span>
          <span
            v-if="task.originalEstimate !== null"
            class="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-900/50 border border-sky-800 text-sky-300 tabular-nums"
            title="Original Estimate"
          >
            {{ task.originalEstimate }}h
          </span>
        </div>
      </div>
    </div>

    <!-- Flat debug table -->
    <details class="group rounded-xl border border-zinc-700 bg-zinc-900 overflow-hidden">
      <summary class="flex items-center justify-between px-4 py-3 cursor-pointer select-none bg-zinc-800 hover:bg-zinc-700 transition-colors">
        <span class="text-sm font-medium text-zinc-300">Raw flat list (debug)</span>
        <span class="text-xs text-zinc-500 group-open:hidden">Show {{ data.allItems.length }} items</span>
        <span class="text-xs text-zinc-500 hidden group-open:inline">Hide</span>
      </summary>
      <div class="overflow-x-auto">
        <table class="w-full text-xs text-left">
          <thead class="sticky top-0 bg-zinc-800 text-zinc-400 uppercase">
            <tr>
              <th class="px-3 py-2">ID</th>
              <th class="px-3 py-2">Type</th>
              <th class="px-3 py-2">Title</th>
              <th class="px-3 py-2">Assigned To</th>
              <th class="px-3 py-2">State</th>
              <th class="px-3 py-2">Start</th>
              <th class="px-3 py-2">Target</th>
              <th class="px-3 py-2">Est. (h)</th>
              <th class="px-3 py-2">Parent</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in data.allItems"
              :key="item.id"
              class="border-t border-zinc-800 hover:bg-zinc-800/50"
            >
              <td class="px-3 py-1.5 text-zinc-400 font-mono">{{ item.id }}</td>
              <td class="px-3 py-1.5">
                <span class="px-1.5 py-0.5 rounded border text-[10px]" :class="typeBadge(item.workItemType)">
                  {{ item.workItemType }}
                </span>
              </td>
              <td class="px-3 py-1.5 text-zinc-200 max-w-xs truncate">{{ item.title }}</td>
              <td class="px-3 py-1.5 text-zinc-400">{{ item.assignedToName }}</td>
              <td class="px-3 py-1.5">
                <span class="px-1.5 py-0.5 rounded text-[10px]" :class="stateBadge(item.state)">{{ item.state }}</span>
              </td>
              <td class="px-3 py-1.5 text-zinc-500 font-mono tabular-nums">{{ item.startDate ?? '—' }}</td>
              <td class="px-3 py-1.5 text-zinc-500 font-mono tabular-nums">{{ item.targetDate ?? '—' }}</td>
              <td class="px-3 py-1.5 text-right tabular-nums">
                <span
                  v-if="item.originalEstimate !== null"
                  class="text-[10px] px-1 py-0.5 rounded bg-sky-900/40 border border-sky-800/60 text-sky-400"
                >{{ item.originalEstimate }}</span>
                <span v-else class="text-zinc-700">—</span>
              </td>
              <td class="px-3 py-1.5 text-zinc-500 font-mono">{{ item.parentId ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>

    <!-- Navigation CTA -->
    <div class="flex justify-end pt-2 pb-4">
      <button
        type="button"
        class="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white transition-colors shadow-lg shadow-blue-900/40"
        @click="emit('go-to-timeline')"
      >
        Open Timeline
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
      </button>
    </div>
  </div>
</template>
