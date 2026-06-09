<script setup lang="ts">
import { ref, computed } from 'vue';
import FileDropzone from './components/FileDropzone.vue';
import DataPreview from './components/DataPreview.vue';
import TimelineView from './components/TimelineView.vue';
import { parseAdoFile } from './utils/parser';
import type { ParsedAdoData } from './types/ado';

type AppState = 'idle' | 'loading' | 'preview' | 'timeline' | 'error';

const appState       = ref<AppState>('idle');
const parsedData     = ref<ParsedAdoData | null>(null);
const currentFileName = ref('');
const errorMessage   = ref('');

async function onFileSelected(file: File) {
  appState.value      = 'loading';
  currentFileName.value = file.name;
  parsedData.value    = null;
  errorMessage.value  = '';
  try {
    parsedData.value = await parseAdoFile(file);
    appState.value   = 'preview';
  } catch (err: unknown) {
    errorMessage.value = err instanceof Error ? err.message : String(err);
    appState.value     = 'error';
  }
}

function goToTimeline() { appState.value = 'timeline'; }
function goToPreview()  { appState.value = 'preview';  }
function reset() {
  appState.value       = 'idle';
  parsedData.value     = null;
  currentFileName.value = '';
  errorMessage.value   = '';
}

// Header breadcrumb labels
const breadcrumb = computed(() => {
  if (appState.value === 'loading')  return 'Parsing file…';
  if (appState.value === 'preview')  return 'Import preview';
  if (appState.value === 'timeline') return 'Timeline';
  if (appState.value === 'error')    return 'Error';
  return null;
});

// The timeline view manages its own scrolling; the main area must not scroll
const mainScrollable = computed(() => appState.value !== 'timeline');
</script>

<template>
  <div class="dark min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">

    <!-- ── Header ─────────────────────────────────────────────────────── -->
    <header class="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 bg-zinc-900 shrink-0">
      <!-- Logo -->
      <div class="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-600 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
        </svg>
      </div>
      <!-- Title + breadcrumb -->
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <span class="text-sm font-semibold text-zinc-100">ADO Offline Planner</span>
        <template v-if="breadcrumb">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-zinc-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
          <span class="text-sm text-zinc-400 truncate">{{ breadcrumb }}</span>
          <span v-if="currentFileName" class="text-xs text-zinc-600 truncate min-w-0">· {{ currentFileName }}</span>
        </template>
      </div>

      <!-- Context actions -->
      <div class="flex items-center gap-2 shrink-0">
        <!-- Back to Preview (when on timeline) -->
        <button
          v-if="appState === 'timeline'"
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
          @click="goToPreview"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to Preview
        </button>

        <!-- Go to Timeline (when on preview) -->
        <button
          v-if="appState === 'preview'"
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors"
          @click="goToTimeline"
        >
          Open Timeline
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </button>

        <!-- Import new file (when not idle) -->
        <button
          v-if="appState !== 'idle'"
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
          @click="reset"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          New import
        </button>
      </div>
    </header>

    <!-- ── Main content ─────────────────────────────────────────────── -->
    <main
      class="flex-1 flex flex-col overflow-hidden"
      :class="mainScrollable ? 'overflow-y-auto' : ''"
    >

      <!-- Idle: dropzone -->
      <div
        v-if="appState === 'idle'"
        class="flex flex-col items-center justify-center flex-1 px-6 py-8"
        style="min-height: 60vh;"
      >
        <div class="mb-8 text-center">
          <h2 class="text-2xl font-bold text-zinc-100">Import ADO Export</h2>
          <p class="mt-2 text-sm text-zinc-400 max-w-md">
            Export a Work Items query from Azure DevOps as CSV or Excel, then drop it here to start planning.
          </p>
        </div>
        <FileDropzone @file-selected="onFileSelected" />
      </div>

      <!-- Loading -->
      <div
        v-else-if="appState === 'loading'"
        class="flex flex-col items-center justify-center gap-4 flex-1"
        style="min-height: 60vh;"
      >
        <div class="w-10 h-10 rounded-full border-2 border-zinc-600 border-t-blue-400 animate-spin" />
        <p class="text-sm text-zinc-400">
          Parsing <span class="text-zinc-200 font-medium">{{ currentFileName }}</span>…
        </p>
      </div>

      <!-- Error -->
      <div
        v-else-if="appState === 'error'"
        class="flex flex-col items-center justify-center gap-6 flex-1"
        style="min-height: 60vh;"
      >
        <div class="flex flex-col items-center gap-3 rounded-2xl bg-red-950/50 border border-red-800 px-8 py-8 max-w-lg text-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <h3 class="text-lg font-semibold text-red-300">Failed to parse file</h3>
          <p class="text-sm text-red-400">{{ errorMessage }}</p>
          <button
            type="button"
            class="mt-2 px-5 py-2 rounded-lg text-sm font-medium bg-red-800 hover:bg-red-700 text-white transition-colors"
            @click="reset"
          >
            Try again
          </button>
        </div>
      </div>

      <!-- Preview -->
      <div
        v-else-if="appState === 'preview' && parsedData"
        class="flex-1 px-6 py-6 overflow-y-auto"
      >
        <DataPreview
          :data="parsedData"
          :file-name="currentFileName"
          @go-to-timeline="goToTimeline"
        />
      </div>

      <!-- Timeline -->
      <TimelineView
        v-else-if="appState === 'timeline' && parsedData"
        :data="parsedData"
        class="flex-1 min-h-0"
      />

    </main>
  </div>
</template>
