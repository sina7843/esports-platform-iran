<script setup lang="ts">
import { ref } from 'vue';
import { tr } from '../locale';
import { SCAN, SCAN_NOTE, sizeLabel, trPair, type FileUploadScanState } from '../maps/inputs';
import QBadge from './QBadge.vue';
import QButton from './QButton.vue';
import QFormField from './QFormField.vue';
import QIcon from './QIcon.vue';

export interface QFileUploadItem { id?: string; name: string; size?: number; scanState: FileUploadScanState; note?: string }
/**
 * FileUpload: dashed drop zone «فایل را اینجا رها کنید یا انتخاب کنید» plus a list of files with the product's scan states
 * (pending, clean, infected, failed + retry, skipped_dev). Files come in through props; emits files(File[]) for picks/drops,
 * remove(file) and retry(file) — the × and «تلاش دوباره» buttons only render when those listeners are bound.
 */
export interface QFileUploadProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  accept?: string;
  multiple?: boolean;
  typesHint?: string;
  dropText?: string;
  pickText?: string;
  listLabel?: string;
  files?: QFileUploadItem[];
  id?: string;
  name?: string;
  /** Listener presence (@remove / @retry) decides whether the buttons render, as in the DS. */
  onRemove?: (file: QFileUploadItem) => void;
  onRetry?: (file: QFileUploadItem) => void;
}
const p = withDefaults(defineProps<QFileUploadProps>(), { multiple: true, files: () => [] });
const emit = defineEmits<{ files: [files: File[]]; remove: [file: QFileUploadItem]; retry: [file: QFileUploadItem] }>();
const drag = ref(false);

function emitFiles(list?: FileList | null) {
  if (list && list.length) emit('files', Array.from(list));
}
function onDragOver(e: DragEvent) {
  if (p.disabled) return;
  e.preventDefault();
  drag.value = true;
}
function onDragLeave(e: DragEvent) {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) drag.value = false;
}
function onDrop(e: DragEvent) {
  e.preventDefault();
  drag.value = false;
  if (!p.disabled) emitFiles(e.dataTransfer?.files);
}
function onChange(e: Event) {
  const el = e.target as HTMLInputElement;
  emitFiles(el.files);
  el.value = '';
}
const scan = (f: QFileUploadItem) => SCAN[f.scanState] ?? SCAN.pending;
const sub = (f: QFileUploadItem) => [sizeLabel(f.size), f.note || trPair(SCAN_NOTE[f.scanState])].filter(Boolean).join(' · ');
const isImage = (name: string) => /\.(png|jpe?g|webp|gif)$/i.test(name);
</script>

<template>
  <div class="q-file-upload">
    <QFormField :id="id" :label="label" :hint="hint" :error="error" :required="required" :disabled="disabled" class="q-file-upload__field">
      <template v-if="$slots.label" #label><slot name="label" /></template>
      <template v-if="$slots.hint" #hint><slot name="hint" /></template>
      <template v-if="$slots.error" #error><slot name="error" /></template>
      <template #default="f">
        <label
          :for="f.id"
          :class="['q-file-upload__zone', { 'q-file-upload__zone--drag': drag, 'q-file-upload__zone--invalid': f.invalid, 'q-file-upload__zone--disabled': disabled }]"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <input
            :id="f.id"
            type="file"
            class="q-file-upload__input"
            :name="name"
            :accept="accept"
            :multiple="multiple"
            :disabled="disabled"
            :required="required && !files.length"
            :aria-invalid="f.invalid ? 'true' : undefined"
            :aria-describedby="[typesHint ? `${f.id}-types` : null, f.describedBy].filter(Boolean).join(' ') || undefined"
            @change="onChange"
          />
          <span class="q-file-upload__badge q-chamfer-sm" aria-hidden="true"><QIcon name="upload" :size="22" /></span>
          <span class="q-file-upload__text">{{ dropText || tr('فایل را اینجا رها کنید یا ', 'Drop files here or ') }}<span class="q-file-upload__pick">{{ pickText || tr('انتخاب کنید', 'browse') }}</span></span>
          <span v-if="typesHint" :id="`${f.id}-types`" class="q-file-upload__types">{{ typesHint }}</span>
        </label>
      </template>
    </QFormField>
    <ul v-if="files.length" class="q-file-upload__list" aria-live="polite" :aria-label="listLabel || tr('فایل‌های پیوست', 'Attached files')">
      <li v-for="file in files" :key="file.id || file.name" :class="['q-file-upload__item', { 'q-file-upload__item--bad': file.scanState === 'infected' || file.scanState === 'failed' }]">
        <span class="q-file-upload__file-icon" aria-hidden="true"><QIcon :name="isImage(file.name) ? 'image' : 'file'" :size="20" /></span>
        <span class="q-file-upload__meta">
          <span class="q-file-upload__name" :title="file.name"><bdi>{{ file.name }}</bdi></span>
          <span class="q-file-upload__sub">{{ sub(file) }}</span>
        </span>
        <QBadge :tone="scan(file).tone" :icon="scan(file).icon" class="q-file-upload__state">{{ trPair(scan(file).label) }}</QBadge>
        <QButton v-if="file.scanState === 'failed' && onRetry" variant="secondary" size="md" icon="refresh" class="q-file-upload__retry" @click="emit('retry', file)">{{ tr('تلاش دوباره', 'Try again') }}</QButton>
        <button v-if="onRemove" type="button" class="q-file-upload__remove" :aria-label="tr('حذف ', 'Remove ') + file.name" @click="emit('remove', file)">
          <QIcon name="trash" :size="18" />
        </button>
      </li>
    </ul>
  </div>
</template>
