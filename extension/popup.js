import { detectProvider } from './src/providers.js';

const $ = (id) => document.getElementById(id);
const els = {
  provider: $('provider'),
  extensionOrigin: $('extension-origin'),
  pairForm: $('pair-form'),
  pairingCode: $('pairing-code'),
  pairButton: $('pair-button'),
  connectionState: $('connection-state'),
  taskForm: $('task-form'),
  prompt: $('prompt'),
  charCount: $('char-count'),
  sendButton: $('send-button'),
  taskState: $('task-state'),
  notice: $('notice'),
};

let activeProvider = null;
let paired = false;
let taskState = 'idle';

function setNotice(text, kind = '') {
  els.notice.textContent = text;
  els.notice.className = `notice ${kind}`.trim();
}

function setState(element, text, kind = '') {
  element.textContent = text;
  element.className = `state ${kind}`.trim();
}

async function message(payload) {
  const result = await chrome.runtime.sendMessage(payload);
  if (!result?.ok) throw new Error(result?.error || 'Extension request failed.');
  return result;
}

function updateControls() {
  const promptReady = els.prompt.value.trim().length > 0;
  els.sendButton.disabled = !paired || !activeProvider || !promptReady || taskState === 'running';
  const bytes = new TextEncoder().encode(els.prompt.value).length;
  els.charCount.textContent = `${bytes.toLocaleString()} bytes / 180 KiB`;
}

function showTaskStatus(status, lastResult) {
  taskState = status?.state || 'idle';
  if (taskState === 'paired' || taskState === 'idle') {
    setState(els.taskState, paired ? 'Ready to send.' : 'Waiting for pairing');
  } else if (taskState === 'running') {
    setState(els.taskState, 'Prompt submitted. Waiting for the assistant to finish…');
  } else if (taskState === 'waiting_review') {
    setState(els.taskState, `Answer sent to Hermes review${lastResult?.resultId ? ` · ${lastResult.resultId}` : ''}.`, 'good');
  } else if (taskState === 'failed') {
    setState(els.taskState, status.error || 'The task failed.', 'bad');
  }
  updateControls();
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeProvider = tab?.url ? detectProvider(tab.url) : null;
  els.provider.textContent = activeProvider || 'Unsupported page';
  els.extensionOrigin.textContent = `chrome-extension://${chrome.runtime.id}`;
  try {
    const status = await message({ type: 'GET_STATUS' });
    paired = status.connected;
    setState(
      els.connectionState,
      paired ? `Paired · ${status.sessionId.slice(0, 8)} · expires ${status.expiresAt}` : 'Not paired',
      paired ? 'good' : '',
    );
    showTaskStatus(status.taskStatus, status.lastResult);
  } catch (error) {
    setState(els.connectionState, 'Could not read extension state.', 'bad');
    setNotice(error.message, 'error');
  }
}

els.pairingCode.addEventListener('input', () => {
  els.pairingCode.value = els.pairingCode.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9-]/g, '').slice(0, 9);
});

els.pairForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.pairButton.disabled = true;
  setNotice('Claiming the one-time code…');
  try {
    const result = await message({ type: 'PAIR', code: els.pairingCode.value.trim() });
    paired = true;
    setState(els.connectionState, `Paired · ${result.sessionId.slice(0, 8)} · expires ${result.expiresAt}`, 'good');
    setNotice('Pairing succeeded. The browser token stays in extension storage.');
    els.pairingCode.value = '';
    updateControls();
  } catch (error) {
    const originHint = /origin|failed to fetch|cors|network/i.test(error.message) ? ` Set Render EXTENSION_ORIGINS to chrome-extension://${chrome.runtime.id} and redeploy.` : '';
    setNotice(`${error.message}${originHint}`, 'error');
  } finally {
    els.pairButton.disabled = false;
  }
});

els.prompt.addEventListener('input', updateControls);
els.taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.sendButton.disabled = true;
  setNotice('Sending the prompt to the active assistant page…');
  try {
    const result = await message({ type: 'START_TASK', prompt: els.prompt.value });
    taskState = 'running';
    setState(els.taskState, `Submitted to ${result.provider}. Keep this page open while it responds.`);
    setNotice('Task started. The final answer will be queued for review in Hermes.');
  } catch (error) {
    setNotice(error.message, 'error');
  } finally {
    updateControls();
  }
});

refresh();
