<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  (e: 'file-selected', file: File): void;
}>();

const isDragging = ref(false);
const errorMessage = ref<string | null>(null);

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'];

function isValidFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function handleFile(file: File) {
  errorMessage.value = null;
  if (!isValidFile(file)) {
    errorMessage.value = `Invalid file type: "${file.name}". Only .csv and .xlsx files are accepted.`;
    return;
  }
  emit('file-selected', file);
}

// --- Drag and Drop handlers ---
function onDragEnter(e: DragEvent) {
  e.preventDefault();
  isDragging.value = true;
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
}

function onDragLeave(e: DragEvent) {
  // Only clear if leaving the dropzone container itself
  const target = e.currentTarget as HTMLElement;
  const relatedTarget = e.relatedTarget as Node | null;
  if (!target.contains(relatedTarget)) {
    isDragging.value = false;
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  isDragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
}

// --- File picker handler ---
function onFileInputChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) handleFile(file);
  // Reset so the same file can be re-selected
  input.value = '';
}

function openFilePicker() {
  document.getElementById('ado-file-input')?.click();
}
</script>

<template>
  <div class="flex flex-col items-center justify-center w-full">
    <!-- Dropzone area -->
    <div
      class="relative flex flex-col items-center justify-center w-full max-w-2xl rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer select-none"
      :class="[
        isDragging
          ? 'border-blue-400 bg-blue-950/40 scale-[1.01]'
          : 'border-zinc-600 bg-zinc-800/50 hover:border-zinc-400 hover:bg-zinc-800',
      ]"
      style="min-height: 220px;"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="openFilePicker"
    >
      <!-- Cloud / upload icon -->
      <div class="mb-4 text-zinc-400" :class="{ 'text-blue-400': isDragging }">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-14 h-14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      </div>

      <p class="text-lg font-semibold text-zinc-200">
        {{ isDragging ? 'Release to import' : 'Drag & drop your ADO export here' }}
      </p>
      <p class="mt-1 text-sm text-zinc-400">or</p>

      <!-- Browse button -->
      <button
        type="button"
        class="mt-3 px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white transition-colors"
        @click.stop="openFilePicker"
      >
        Browse file…
      </button>

      <p class="mt-4 text-xs text-zinc-500">Accepted formats: .csv · .xlsx</p>

      <!-- Hidden file input -->
      <input
        id="ado-file-input"
        type="file"
        class="hidden"
        :accept="ACCEPTED_EXTENSIONS.join(',')"
        @change="onFileInputChange"
      />
    </div>

    <!-- Error message -->
    <div
      v-if="errorMessage"
      class="mt-4 flex items-start gap-3 w-full max-w-2xl rounded-lg bg-red-950/60 border border-red-700 px-4 py-3 text-sm text-red-300"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 shrink-0 mt-0.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      <span>{{ errorMessage }}</span>
    </div>
  </div>
</template>
