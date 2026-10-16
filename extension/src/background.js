import { detectProvider, isProviderHost } from './providers.js';
import { claimPairing, submitResult } from './relay-api.js';

async function setBadge(chromeApi, text, color = '#5865f2') {
  try {
    await chromeApi.action.setBadgeBackgroundColor({ color });
    await chromeApi.action.setBadgeText({ text });
  } catch {
    // Badge support is cosmetic; relay state remains authoritative.
  }
}

export function installBackground(chromeApi, fetchImpl = globalThis.fetch) {
  async function getPairing() {
    const stored = await chromeApi.storage.local.get('pairing');
    return stored?.pairing || null;
  }

  async function handle(message, sender) {
    if (message.type === 'PAIR') {
      const pairing = await claimPairing(message.code, { fetchImpl });
      await chromeApi.storage.local.set({
        pairing,
        taskStatus: { state: 'paired', updatedAt: new Date().toISOString() },
        lastResult: null,
      });
      await setBadge(chromeApi, 'ON', '#198754');
      return { ok: true, sessionId: pairing.sessionId, expiresAt: pairing.expiresAt };
    }

    if (message.type === 'GET_STATUS') {
      const stored = await chromeApi.storage.local.get(['pairing', 'taskStatus', 'lastResult']);
      return {
        ok: true,
        connected: Boolean(stored?.pairing?.browserToken && stored?.pairing?.sessionId),
        sessionId: stored?.pairing?.sessionId || null,
        expiresAt: stored?.pairing?.expiresAt || null,
        taskStatus: stored?.taskStatus || { state: 'idle' },
        lastResult: stored?.lastResult || null,
        extensionOrigin: `chrome-extension://${chromeApi.runtime.id}`,
      };
    }

    if (message.type === 'START_TASK') {
      const pairing = await getPairing();
      if (!pairing) throw new Error('Pair this extension with a one-time Hermes code first.');
      if (typeof message.prompt !== 'string' || !message.prompt.trim()) throw new Error('Enter a prompt first.');
      const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
      const provider = tab?.url ? detectProvider(tab.url) : null;
      if (!tab?.id || !provider) throw new Error('Open ChatGPT, Gemini, DeepSeek, or Claude in the active tab.');
      const response = await chromeApi.tabs.sendMessage(tab.id, {
        type: 'START_TASK',
        provider,
        prompt: message.prompt,
        sessionId: pairing.sessionId,
      });
      if (!response?.ok) throw new Error(response?.error || 'The provider page did not accept the task.');
      await chromeApi.storage.local.set({ taskStatus: { state: 'running', provider, updatedAt: new Date().toISOString() } });
      return { ok: true, provider };
    }

    if (message.type === 'RESULT_COMPLETE') {
      const url = sender?.tab?.url;
      if (!url || !isProviderHost(message.provider, url)) throw new Error('Result came from an unsupported page.');
      const pairing = await getPairing();
      if (!pairing || pairing.sessionId !== message.sessionId) throw new Error('The browser pairing changed before this answer arrived.');
      const result = await submitResult(pairing, { provider: message.provider, text: message.text }, { fetchImpl });
      await chromeApi.storage.local.set({
        lastResult: { resultId: result.resultId, provider: message.provider, status: result.status },
        taskStatus: { state: 'waiting_review', provider: message.provider, updatedAt: new Date().toISOString() },
      });
      await setBadge(chromeApi, '1', '#d97706');
      return { ok: true, status: result.status, resultId: result.resultId };
    }

    if (message.type === 'TASK_SUBMITTED') {
      await chromeApi.storage.local.set({ taskStatus: { state: 'running', provider: message.provider, updatedAt: new Date().toISOString() } });
      return { ok: true };
    }

    if (message.type === 'TASK_FAILED') {
      await chromeApi.storage.local.set({ taskStatus: { state: 'failed', error: String(message.error || 'Task failed.'), updatedAt: new Date().toISOString() } });
      await setBadge(chromeApi, '!', '#b42318');
      return { ok: true };
    }

    return null;
  }

  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handled = ['PAIR', 'GET_STATUS', 'START_TASK', 'RESULT_COMPLETE', 'TASK_SUBMITTED', 'TASK_FAILED'].includes(message?.type);
    if (!handled) return false;
    handle(message, sender)
      .then((result) => { if (result) sendResponse(result); })
      .catch((error) => sendResponse({ ok: false, error: error?.message || 'Connect Char request failed.' }));
    return true;
  });
}

if (globalThis.chrome?.runtime?.onMessage) installBackground(globalThis.chrome);
