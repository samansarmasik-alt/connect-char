(() => {
  'use strict';

  const HOSTS = {
    chatgpt: ['chatgpt.com', 'chat.openai.com'],
    gemini: ['gemini.google.com'],
    deepseek: ['chat.deepseek.com'],
    claude: ['claude.ai'],
  };
  const SELECTORS = {
    chatgpt: {
      inputs: ['#prompt-textarea', 'textarea[data-testid="prompt-textarea"]', '[contenteditable="true"][data-testid="prompt-textarea"]'],
      responses: ['[data-message-author-role="assistant"]'],
      send: ['button[data-testid="send-button"]', 'button[aria-label*="Send" i]', 'button[aria-label*="Gönder" i]'],
      stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
    },
    gemini: {
      inputs: ['rich-textarea [contenteditable="true"]', 'div[role="textbox"][contenteditable="true"]', 'textarea'],
      responses: ['model-response', '[data-message-author-role="model"]', 'model-response .markdown'],
      send: ['button[aria-label*="Send" i]', 'button[aria-label*="Gönder" i]', 'button[data-testid="send-button"]'],
      stop: ['button[aria-label*="Stop" i]', 'button[aria-label*="Durdur" i]'],
    },
    deepseek: {
      inputs: ['textarea', '[contenteditable="true"]', '[role="textbox"]'],
      responses: ['[data-role="assistant"]', '.ds-markdown'],
      send: ['button[aria-label*="Send" i]', 'button[aria-label*="Gönder" i]', 'button[data-testid="send-button"]'],
      stop: ['button[aria-label*="Stop" i]', 'button[aria-label*="Durdur" i]'],
    },
    claude: {
      inputs: ['div[contenteditable="true"][data-placeholder]', '[contenteditable="true"][role="textbox"]', 'textarea'],
      responses: ['[data-message-author-role="assistant"]', '[data-testid="chat-message"] .font-claude-message', '.font-claude-message'],
      send: ['button[data-testid="send-button"]', 'button[aria-label*="Send" i]', 'button[aria-label*="Gönder" i]'],
      stop: ['button[aria-label*="Stop" i]', 'button[aria-label*="Durdur" i]'],
    },
  };
  const MAX_PROMPT_BYTES = 180 * 1024;
  const RESULT_STABLE_MS = 6_000;
  const MAX_TASK_MS = 45 * 60 * 1000;
  let activeTask = null;

  function matchesHost(hostname, provider) {
    return HOSTS[provider].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  }

  function detectCurrentProvider() {
    const hostname = String(globalThis.location?.hostname || '').toLowerCase();
    return Object.keys(HOSTS).find((provider) => matchesHost(hostname, provider)) || null;
  }

  function isVisible(element) {
    if (!element || element.disabled || element.getAttribute?.('aria-hidden') === 'true') return false;
    return typeof element.getClientRects !== 'function' || element.getClientRects().length > 0;
  }

  function responseNodes(provider) {
    const config = SELECTORS[provider];
    if (!config) return [];
    const found = new Set();
    for (const selector of config.responses) {
      try {
        for (const element of globalThis.document.querySelectorAll(selector)) {
          if (isVisible(element)) found.add(element);
        }
      } catch {
        // Ignore a selector unsupported by an evolving provider UI.
      }
    }
    return [...found];
  }

  function nodeText(element) {
    return String(element?.innerText ?? element?.textContent ?? '').trim();
  }

  function readLatestResponse(provider) {
    const nodes = responseNodes(provider);
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const text = nodeText(nodes[index]);
      if (text) return text;
    }
    return '';
  }

  function findInput(provider) {
    const config = SELECTORS[provider];
    if (!config) return null;
    for (const selector of config.inputs) {
      try {
        const candidate = [...globalThis.document.querySelectorAll(selector)].find(isVisible);
        if (candidate) return candidate;
      } catch {
        // Ignore a selector unsupported by an evolving provider UI.
      }
    }
    return null;
  }

  function fireInputEvents(element, text) {
    const win = globalThis.window || globalThis;
    try {
      element.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    } catch {
      element.dispatchEvent(new win.Event('input', { bubbles: true }));
    }
    element.dispatchEvent(new win.Event('change', { bubbles: true }));
  }

  function setInputText(element, text) {
    element.focus?.();
    const editable = element.isContentEditable || element.getAttribute?.('contenteditable') === 'true';
    if (editable) {
      let inserted = false;
      try {
        globalThis.document.execCommand?.('selectAll', false);
        inserted = Boolean(globalThis.document.execCommand?.('insertText', false, text));
      } catch {
        inserted = false;
      }
      if (!inserted) {
        element.textContent = text;
        if ('innerText' in element) element.innerText = text;
      }
      fireInputEvents(element, text);
      return;
    }

    let prototype = Object.getPrototypeOf(element);
    let setter;
    while (prototype && !setter) {
      setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      prototype = Object.getPrototypeOf(prototype);
    }
    if (setter) setter.call(element, text);
    else element.value = text;
    fireInputEvents(element, text);
  }

  function findSendButton(provider, input) {
    const config = SELECTORS[provider];
    for (const selector of config.send) {
      try {
        const candidate = [...globalThis.document.querySelectorAll(selector)].find(isVisible);
        if (candidate) return candidate;
      } catch {
        // Continue to accessible-label fallback.
      }
    }
    const formButton = input.closest?.('form')?.querySelector?.('button[type="submit"]');
    if (isVisible(formButton)) return formButton;
    try {
      const buttons = [...globalThis.document.querySelectorAll('button')].filter(isVisible);
      return buttons.find((button) => /send|gönder/i.test([
        button.getAttribute?.('aria-label'), button.getAttribute?.('title'), button.innerText, button.textContent,
      ].join(' '))) || null;
    } catch {
      return null;
    }
  }

  function isGenerating(provider) {
    const config = SELECTORS[provider];
    return config.stop.some((selector) => {
      try {
        return [...globalThis.document.querySelectorAll(selector)].some(isVisible);
      } catch {
        return false;
      }
    });
  }

  function stopTask(task) {
    if (task.observer) task.observer.disconnect();
    if (task.stableTimer) clearTimeout(task.stableTimer);
    if (task.timeoutTimer) clearTimeout(task.timeoutTimer);
    if (activeTask === task) activeTask = null;
  }

  function finishTask(task, text) {
    stopTask(task);
    if (new TextEncoder().encode(text).length > 256 * 1024) {
      chrome.runtime.sendMessage({ type: 'TASK_FAILED', error: 'Answer exceeds the relay 256 KiB limit.' });
      return;
    }
    Promise.resolve(chrome.runtime.sendMessage({ type: 'RESULT_COMPLETE', sessionId: task.sessionId, provider: task.provider, text }))
      .then((result) => {
        if (!result?.ok) chrome.runtime.sendMessage({ type: 'TASK_FAILED', error: result?.error || 'Relay did not accept the answer.' });
      })
      .catch(() => chrome.runtime.sendMessage({ type: 'TASK_FAILED', error: 'Could not reach the relay from the extension.' }));
  }

  function observeTask(task) {
    const inspect = () => {
      if (activeTask !== task) return;
      const nodes = responseNodes(task.provider);
      const latestNode = nodes[nodes.length - 1];
      const latestText = nodeText(latestNode);
      const isNewNode = latestNode && !task.baselineNodes.has(latestNode);
      if ((!isNewNode && latestText === task.baselineText) || !latestText) return;

      if (latestText !== task.lastText) {
        task.lastText = latestText;
        if (task.stableTimer) clearTimeout(task.stableTimer);
      }
      if (task.stableTimer) clearTimeout(task.stableTimer);
      task.stableTimer = setTimeout(() => {
        if (activeTask !== task) return;
        if (isGenerating(task.provider)) {
          task.stableTimer = setTimeout(inspect, 1_500);
          return;
        }
        const current = readLatestResponse(task.provider);
        if (current && current === task.lastText) finishTask(task, current);
        else inspect();
      }, RESULT_STABLE_MS);
    };

    task.observer = new MutationObserver(inspect);
    task.observer.observe(globalThis.document.documentElement || globalThis.document.body, {
      childList: true, characterData: true, subtree: true,
    });
    task.timeoutTimer = setTimeout(() => {
      if (activeTask === task) {
        stopTask(task);
        chrome.runtime.sendMessage({ type: 'TASK_FAILED', error: 'Timed out waiting for the assistant response.' });
      }
    }, MAX_TASK_MS);
  }

  async function startTask(provider, prompt, sessionId) {
    if (provider !== detectCurrentProvider()) throw new Error('Open a supported assistant page before sending.');
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Pair this tab with a Hermes session first.');
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Enter a prompt first.');
    if (new TextEncoder().encode(prompt).length > MAX_PROMPT_BYTES) throw new Error('Prompt is too large (180 KiB maximum).');
    if (activeTask) stopTask(activeTask);

    const input = findInput(provider);
    if (!input) throw new Error('Could not find the prompt box. The provider page may have changed.');
    const baselineNodes = new Set(responseNodes(provider));
    const baselineText = readLatestResponse(provider);
    setInputText(input, prompt);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const sendButton = findSendButton(provider, input);
    if (!sendButton) throw new Error('Could not find the Send button. Check the page and try again.');
    if (sendButton.disabled) throw new Error('The Send button is disabled; wait for the page to finish loading.');

    const task = { sessionId, provider, baselineNodes, baselineText, lastText: '', observer: null, stableTimer: null, timeoutTimer: null };
    activeTask = task;
    observeTask(task);
    sendButton.click();
    chrome.runtime.sendMessage({ type: 'TASK_SUBMITTED', provider });
    return { ok: true, provider };
  }

  globalThis.ConnectCharContent = Object.freeze({
    detectCurrentProvider,
    responseNodes,
    readLatestResponse,
    findInput,
    startTask,
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'START_TASK') return false;
    startTask(message.provider, message.prompt, message.sessionId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
