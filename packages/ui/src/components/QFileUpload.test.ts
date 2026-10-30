import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QFileUpload from './QFileUpload.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));
const files = [
  { id: '1', name: 'shot.png', size: 2516582, scanState: 'clean' as const },
  { id: '2', name: 'log.txt', size: 512, scanState: 'failed' as const },
];

describe('QFileUpload', () => {
  it('drop zone strings and file list with scan states (fa)', () => {
    const w = mount(QFileUpload, { props: { id: 'u', label: 'مدرک', typesHint: 'PNG', files } });
    expect(w.classes()).toContain('q-file-upload');
    expect(w.find('.q-file-upload__text').text()).toBe('فایل را اینجا رها کنید یا انتخاب کنید');
    const input = w.find('input[type=file]');
    expect(input.attributes('multiple')).toBeDefined();
    expect(input.attributes('aria-describedby')).toBe('u-types');
    expect(w.find('.q-file-upload__list').attributes('aria-label')).toBe('فایل‌های پیوست');
    const items = w.findAll('.q-file-upload__item');
    expect(items[0]!.find('.q-file-upload__sub').text()).toBe('۲٫۴ مگابایت');
    expect(items[0]!.find('.q-badge').text()).toBe('سالم');
    expect(items[1]!.classes()).toContain('q-file-upload__item--bad');
    expect(items[1]!.find('.q-file-upload__sub').text()).toBe('۵۱۲ بایت · بررسی انجام نشد؛ دوباره تلاش کنید.');
    // no listeners → no remove / retry buttons (DS: onRemove / onRetry presence)
    expect(w.find('.q-file-upload__remove').exists()).toBe(false);
    expect(w.find('.q-file-upload__retry').exists()).toBe(false);
  });
  it('en strings; remove / retry emit when bound', async () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QFileUpload, { props: { files, onRemove: () => {}, onRetry: () => {} } });
    expect(w.find('.q-file-upload__text').text()).toBe('Drop files here or browse');
    expect(w.findAll('.q-file-upload__sub')[0]!.text()).toBe('2.4 MB');
    await w.find('.q-file-upload__retry').trigger('click');
    expect(w.emitted('retry')?.[0]).toEqual([files[1]]);
    const rm = w.findAll('.q-file-upload__remove');
    expect(rm[0]!.attributes('aria-label')).toBe('Remove shot.png');
    await rm[0]!.trigger('click');
    expect(w.emitted('remove')?.[0]).toEqual([files[0]]);
  });
  it('drop emits files', async () => {
    const w = mount(QFileUpload, {});
    const f = new File(['x'], 'a.pdf');
    await w.find('label.q-file-upload__zone').trigger('drop', { dataTransfer: { files: [f] } });
    expect(w.emitted('files')?.[0]).toEqual([[f]]);
  });
});
