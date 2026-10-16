import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');

function loadContent(hostname, nodesBySelector = {}, overrides = {}) {
  let onMessage;
  const outgoing = [];
  const fakeDocument = overrides.document || {
    querySelectorAll(selector) { return nodesBySelector[selector] || []; },
    querySelector() { return null; },
    body: { addEventListener() {} },
    documentElement: {},
  };
  const sandbox = {
    location: { hostname },
    document: fakeDocument,
    chrome: {
      runtime: {
        onMessage: { addListener(handler) { onMessage = handler; } },
        sendMessage(message) { outgoing.push(message); return Promise.resolve({ ok: true }); },
      },
    },
    console,
    TextEncoder,
    setTimeout(callback, delay) { return delay < 1_000 ? globalThis.setTimeout(callback, delay) : { callback, delay }; },
    clearTimeout(handle) { if (typeof handle === 'number') globalThis.clearTimeout(handle); },
    MutationObserver: class { observe() {} disconnect() {} },
  };
  sandbox.window = { InputEvent: class { constructor(type, init) { this.type = type; this.init = init; } }, Event: class { constructor(type, init) { this.type = type; this.init = init; } } };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'content.js' });
  return { api: sandbox.ConnectCharContent, onMessage, outgoing };
}

test('content script detects only the supported provider origins', () => {
  assert.equal(loadContent('chatgpt.com').api.detectCurrentProvider(), 'chatgpt');
  assert.equal(loadContent('gemini.google.com').api.detectCurrentProvider(), 'gemini');
  assert.equal(loadContent('chat.deepseek.com').api.detectCurrentProvider(), 'deepseek');
  assert.equal(loadContent('claude.ai').api.detectCurrentProvider(), 'claude');
  assert.equal(loadContent('claude.ai.attacker.example').api.detectCurrentProvider(), null);
});

test('content script reads only the newest non-empty assistant response', () => {
  const oldAnswer = { innerText: 'old answer' };
  const newAnswer = { innerText: '  newest answer\n ' };
  const { api } = loadContent('chatgpt.com', {
    '[data-message-author-role="assistant"]': [oldAnswer, newAnswer],
  });
  assert.equal(api.readLatestResponse('chatgpt'), 'newest answer');
});

test('content script ignores pages that have no assistant output yet', () => {
  const { api } = loadContent('claude.ai');
  assert.equal(api.readLatestResponse('claude'), '');
});

test('content script fills the supported prompt box and clicks Send only when asked', async () => {
  const promptText = 'A project plan with multiple phases';
  let clicked = false;
  const input = {
    value: '', disabled: false, tagName: 'TEXTAREA',
    getAttribute() { return null; }, getClientRects() { return [1]; },
    focus() {}, dispatchEvent() {}, closest() { return null; },
  };
  const button = {
    disabled: false, innerText: '', textContent: '',
    getAttribute() { return null; }, getClientRects() { return [1]; },
    click() { clicked = true; },
  };
  const fakeDocument = {
    documentElement: {}, body: {},
    querySelectorAll(selector) {
      if (selector === '#prompt-textarea') return [input];
      if (selector === 'button[data-testid="send-button"]') return [button];
      return [];
    },
    querySelector() { return null; },
  };
  const { api, outgoing } = loadContent('chatgpt.com', {}, { document: fakeDocument });
  const result = await api.startTask('chatgpt', promptText, 'ad1c249e-46a5-428d-b644-f709f540ba8c');
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'chatgpt');
  assert.equal(input.value, promptText);
  assert.equal(clicked, true);
  assert.ok(outgoing.some((message) => message.type === 'TASK_SUBMITTED'));
});
