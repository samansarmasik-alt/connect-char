import test from 'node:test';
import assert from 'node:assert/strict';
import { installBackground } from '../src/background.js';

const pairing = {
  sessionId: 'ad1c249e-46a5-428d-b644-f709f540ba8c',
  browserToken: 'browser-token-for-test-only',
  expiresAt: '2026-10-17T00:00:00.000Z',
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeChrome(initial = {}) {
  const store = { ...initial };
  const listeners = [];
  const calls = { tabs: [], badge: [], storage: [] };
  let activeTab = { id: 4, url: 'https://chatgpt.com/' };
  const chrome = {
    runtime: {
      id: 'test-extension-id',
      onMessage: { addListener(listener) { listeners.push(listener); } },
    },
    storage: {
      local: {
        async get(key) { return { [key]: store[key] }; },
        async set(values) { Object.assign(store, values); calls.storage.push(values); },
      },
    },
    tabs: {
      async query() { return [activeTab]; },
      async sendMessage(tabId, message) { calls.tabs.push({ tabId, message }); return { ok: true, provider: message.provider }; },
    },
    action: {
      async setBadgeText(value) { calls.badge.push(value); },
      async setBadgeBackgroundColor() {},
    },
  };
  return {
    chrome, store, calls,
    setActiveTab(tab) { activeTab = tab; },
    async dispatch(message, sender = {}) {
      const listener = listeners[0];
      return new Promise((resolve) => {
        const keep = listener(message, sender, resolve);
        if (keep !== true) resolve({ ignored: true });
      });
    },
  };
}

test('pairing stores browser capability privately and does not return it to popup', async () => {
  const state = fakeChrome();
  installBackground(state.chrome, async (_url, init) => {
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { code: 'ABCD-EFGH' });
    return response(200, pairing);
  });
  const result = await state.dispatch({ type: 'PAIR', code: 'ABCD-EFGH' });
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, pairing.sessionId);
  assert.equal('browserToken' in result, false);
  assert.deepEqual(state.store.pairing, pairing);
});

test('start task targets only a recognized active provider and passes no token to content', async () => {
  const state = fakeChrome({ pairing });
  installBackground(state.chrome, async () => { throw new Error('network should not be called'); });
  const result = await state.dispatch({ type: 'START_TASK', prompt: 'Plan a project' });
  assert.equal(result.ok, true);
  assert.equal(state.calls.tabs.length, 1);
  assert.deepEqual(state.calls.tabs[0].message, {
    type: 'START_TASK', provider: 'chatgpt', prompt: 'Plan a project', sessionId: pairing.sessionId,
  });
  assert.equal(JSON.stringify(state.calls.tabs[0].message).includes(pairing.browserToken), false);
});

test('completed assistant response is sent only from its paired supported tab', async () => {
  const state = fakeChrome({ pairing });
  let request;
  installBackground(state.chrome, async (url, init) => {
    request = { url, init };
    return response(201, { resultId: 'result-id', status: 'pending_review' });
  });
  const result = await state.dispatch({
    type: 'RESULT_COMPLETE', sessionId: pairing.sessionId, provider: 'chatgpt', text: 'answer',
  }, { tab: { id: 4, url: 'https://chatgpt.com/c/1' } });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'pending_review');
  assert.equal(request.url, `https://connect-char-relay.onrender.com/v1/sessions/${pairing.sessionId}/results`);
  assert.equal(request.init.headers.authorization, `Bearer ${pairing.browserToken}`);
  assert.deepEqual(state.store.lastResult, { resultId: 'result-id', provider: 'chatgpt', status: 'pending_review' });
});

test('response from a mismatched tab or replaced pairing is refused locally', async () => {
  const state = fakeChrome({ pairing });
  let requested = false;
  installBackground(state.chrome, async () => { requested = true; });
  const result = await state.dispatch({
    type: 'RESULT_COMPLETE', sessionId: 'another-session', provider: 'chatgpt', text: 'answer',
  }, { tab: { id: 4, url: 'https://chatgpt.com/c/1' } });
  assert.equal(result.ok, false);
  assert.equal(requested, false);
});
