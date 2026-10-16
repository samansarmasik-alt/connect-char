import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProvider } from '../src/providers.js';
import { claimPairing, submitResult } from '../src/relay-api.js';

const pairing = {
  sessionId: 'ad1c249e-46a5-428d-b644-f709f540ba8c',
  browserToken: 'browser-token-for-test-only',
  expiresAt: '2026-10-17T00:00:00.000Z',
};

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('provider detection recognizes the four supported assistant sites', () => {
  assert.equal(detectProvider('https://chatgpt.com/c/123'), 'chatgpt');
  assert.equal(detectProvider('https://chat.openai.com/'), 'chatgpt');
  assert.equal(detectProvider('https://gemini.google.com/app'), 'gemini');
  assert.equal(detectProvider('https://chat.deepseek.com/'), 'deepseek');
  assert.equal(detectProvider('https://claude.ai/new'), 'claude');
  assert.equal(detectProvider('https://evilclaude.ai/'), null);
});

test('claimPairing normalizes the code and returns the session capability', async () => {
  let request;
  const result = await claimPairing('abcd-efgh', {
    relayUrl: 'https://relay.example',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(200, pairing);
    },
  });
  assert.equal(request.url, 'https://relay.example/v1/pairings/claim');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(request.init.body), { code: 'ABCD-EFGH' });
  assert.deepEqual(result, pairing);
});

test('claimPairing rejects malformed codes before making a request', async () => {
  let requested = false;
  await assert.rejects(
    claimPairing('ABCD-EF!H', { fetchImpl: async () => { requested = true; } }),
    /format/i,
  );
  assert.equal(requested, false);
});

test('submitResult sends only the browser capability and result to the relay', async () => {
  let request;
  const result = await submitResult(pairing, { provider: 'claude', text: 'answer' }, {
    relayUrl: 'https://relay.example',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(201, { resultId: 'result-id', status: 'pending_review' });
    },
  });
  assert.equal(request.url, `https://relay.example/v1/sessions/${pairing.sessionId}/results`);
  assert.equal(request.init.headers.authorization, `Bearer ${pairing.browserToken}`);
  assert.deepEqual(JSON.parse(request.init.body), { provider: 'claude', text: 'answer' });
  assert.deepEqual(result, { resultId: 'result-id', status: 'pending_review' });
});

test('submitResult refuses unsupported providers and blank answers', async () => {
  let requested = false;
  const options = { fetchImpl: async () => { requested = true; } };
  await assert.rejects(submitResult(pairing, { provider: 'other', text: 'answer' }, options), /provider/i);
  await assert.rejects(submitResult(pairing, { provider: 'chatgpt', text: '  ' }, options), /answer/i);
  assert.equal(requested, false);
});

test('relay API surfaces server errors without leaking request credentials', async () => {
  const error = await assert.rejects(
    claimPairing('ABCD-EFGH', {
      relayUrl: 'https://relay.example',
      fetchImpl: async () => response(403, { error: { code: 'origin_denied', message: 'origin denied' } }),
    }),
    /origin denied/,
  );
  assert.equal(String(error).includes(pairing.browserToken), false);
});
