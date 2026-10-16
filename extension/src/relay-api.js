import { SUPPORTED_PROVIDERS } from './providers.js';

export const DEFAULT_RELAY_URL = 'https://connect-char-relay.onrender.com';
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const MAX_RESULT_BYTES = 256 * 1024;

function endpoint(relayUrl, path) {
  const base = new URL(relayUrl || DEFAULT_RELAY_URL);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') {
    throw new Error('Relay URL must use HTTPS.');
  }
  return new URL(path, base.href.endsWith('/') ? base : `${base.href}/`).toString();
}

async function readJson(response) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Relay returned invalid JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string' ? payload.error.message : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function claimPairing(code, { relayUrl = DEFAULT_RELAY_URL, fetchImpl = globalThis.fetch } = {}) {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code.trim().toUpperCase())) {
    throw new Error('Pairing code format must be XXXX-XXXX.');
  }
  const response = await fetchImpl(endpoint(relayUrl, '/v1/pairings/claim'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: code.trim().toUpperCase() }),
  });
  const payload = await readJson(response);
  if (typeof payload.sessionId !== 'string' || typeof payload.browserToken !== 'string' || typeof payload.expiresAt !== 'string') {
    throw new Error('Relay returned an incomplete pairing.');
  }
  return payload;
}

export async function submitResult(pairing, { provider, text }, { relayUrl = DEFAULT_RELAY_URL, fetchImpl = globalThis.fetch } = {}) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) throw new Error('Unsupported provider.');
  if (typeof text !== 'string' || !text.trim()) throw new Error('Answer cannot be empty.');
  if (new TextEncoder().encode(text).length > MAX_RESULT_BYTES) throw new Error('Answer exceeds the 256 KiB limit.');
  if (!pairing || typeof pairing.sessionId !== 'string' || typeof pairing.browserToken !== 'string') {
    throw new Error('Connect the extension with a pairing code first.');
  }
  const response = await fetchImpl(endpoint(relayUrl, `/v1/sessions/${encodeURIComponent(pairing.sessionId)}/results`), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${pairing.browserToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ provider, text }),
  });
  const payload = await readJson(response);
  if (typeof payload.resultId !== 'string' || payload.status !== 'pending_review') {
    throw new Error('Relay did not queue the answer for review.');
  }
  return payload;
}
