import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { setLocale } from '../locale';
import QChatPanel, { type QChatPanelMessage } from './QChatPanel.vue';

afterEach(() => setLocale('fa', { keepDocument: true }));

const messages: QChatPanelMessage[] = [
  { id: 1, side: 'own', text: 'سلام' },
  { id: 2, side: 'referee', text: 'آماده؟', channel: 'officials' },
  { id: 3, side: 'system', text: 'بازی شروع شد' },
];

describe('QChatPanel', () => {
  it('labelled section, log role, counts and message sides', () => {
    const w = mount(QChatPanel, { props: { messages } });
    expect(w.classes()).toEqual(['q-chat-panel']);
    expect(w.attributes('aria-labelledby')).toBe(w.find('h3').attributes('id'));
    expect(w.find('.q-chat-panel__count').text()).toBe('۲ پیام');
    const log = w.find('ol');
    expect(log.attributes('role')).toBe('log');
    expect(log.attributes('aria-live')).toBe('polite');
    expect(log.attributes('tabindex')).toBe('0');
    expect(w.find('.q-chat-panel__msg--own .q-chat-panel__author').text()).toBe('شما');
    expect(w.find('.q-chat-panel__msg--referee .q-badge').text()).toBe('داور');
    expect(w.find('.q-chat-panel__private').text()).toBe('فقط داور');
    expect(w.find('.q-chat-panel__sys').text()).toBe('بازی شروع شد');
    expect(w.find('[role="radiogroup"]').attributes('aria-labelledby')).toBe(w.find('.q-chat-panel__channel-label').attributes('id'));
    expect(w.find('label.q-sr').attributes('for')).toBe(w.find('textarea').attributes('id'));
  });
  it('Enter sends with the channel and clears; Shift+Enter does not', async () => {
    const w = mount(QChatPanel, { props: { messages: [] } });
    const ta = w.find('textarea');
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeDefined();
    await ta.setValue('  gg  ');
    await ta.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(w.emitted('send')).toBeUndefined();
    await ta.trigger('keydown', { key: 'Enter' });
    expect(w.emitted('send')).toEqual([['gg', 'all']]);
    expect((ta.element as HTMLTextAreaElement).value).toBe('');
  });
  it('v-model:channel and channelChange', async () => {
    const w = mount(QChatPanel, {
      props: { messages: [], channel: 'all', 'onUpdate:channel': (v: string | undefined) => w.setProps({ channel: v }) },
    });
    await w.findAll('input[type="radio"]')[1]!.setValue(true);
    expect(w.emitted('channelChange')).toEqual([['officials']]);
    expect(w.emitted('update:channel')).toEqual([['officials']]);
    expect(w.find('.q-chat-panel__opt.is-on').text()).toBe('فقط داور');
    await w.find('textarea').setValue('x');
    await w.find('form').trigger('submit');
    expect(w.emitted('send')).toEqual([['x', 'officials']]);
  });
  it('en strings; showCount / showChannel off', () => {
    setLocale('en', { keepDocument: true });
    const w = mount(QChatPanel, { props: { messages: [] } });
    expect(w.find('h3').text()).toBe('Chat');
    expect(w.find('.q-chat-panel__count').text()).toBe('0 messages');
    expect(w.find('.q-chat-panel__sys').text()).toBe('No messages yet.');
    expect(w.find('.q-chat-panel__channel-label').text()).toBe('Recipient');
    expect(w.find('button[type="submit"]').text()).toBe('Send');
    const off = mount(QChatPanel, { props: { messages: [], showCount: false, showChannel: false } });
    expect(off.find('.q-chat-panel__count').exists()).toBe(false);
    expect(off.find('[role="radiogroup"]').exists()).toBe(false);
  });
});
