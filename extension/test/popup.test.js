import test from 'node:test';
import assert from 'node:assert/strict';

function fakeElement(id) {
  return {
    id, value: '', textContent: '', className: '', disabled: false, handlers: new Map(),
    addEventListener(type, handler) { this.handlers.set(type, handler); },
  };
}

test('popup starts a fixed handoff from the active conversation without manual prompt text', async () => {
  const ids = ['provider', 'extension-origin', 'pair-form', 'pairing-code', 'pair-button', 'connection-state', 'task-form', 'send-button', 'task-state', 'notice'];
  const elements = Object.fromEntries(ids.map((id) => [id, fakeElement(id)]));
  const sent = [];
  globalThis.document = { getElementById: (id) => elements[id] };
  globalThis.chrome = {
    runtime: {
      id: 'test-extension-id',
      async sendMessage(message) {
        sent.push(message);
        if (message.type === 'GET_STATUS') return { ok: true, connected: false, taskStatus: { state: 'idle' }, lastResult: null };
        if (message.type === 'PAIR') return { ok: true, sessionId: 'ad1c249e-46a5-428d-b644-f709f540ba8c', expiresAt: '2026-10-17T00:00:00.000Z' };
        if (message.type === 'START_TASK') return { ok: true, provider: 'chatgpt' };
        throw new Error('Unexpected message');
      },
    },
    tabs: { async query() { return [{ id: 1, url: 'https://chatgpt.com/' }]; } },
  };
  await import(`../popup.js?test=${Date.now()}`);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(elements.provider.textContent, 'chatgpt');
  assert.equal(elements['extension-origin'].textContent, 'chrome-extension://test-extension-id');

  elements['pairing-code'].value = 'ABCD-EFGH';
  await elements['pair-form'].handlers.get('submit')({ preventDefault() {} });
  assert.equal(elements['connection-state'].textContent.startsWith('Paired'), true);
  assert.equal(elements['send-button'].disabled, false);

  await elements['task-form'].handlers.get('submit')({ preventDefault() {} });
  const task = sent.find((message) => message.type === 'START_TASK');
  assert.ok(task?.prompt);
  assert.match(task.prompt, /entire accessible conversation/i);
  assert.match(task.prompt, /redact.*API keys/i);
  assert.equal(elements['task-state'].textContent.includes('Submitted to chatgpt'), true);

  delete globalThis.document;
  delete globalThis.chrome;
});
