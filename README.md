# Connect Char

Connect Char pairs a Chrome extension with a Hermes session through `https://connect-char-relay.onrender.com`. It can submit a prompt to an open ChatGPT, Gemini, DeepSeek, or Claude web chat, then put the completed answer into Hermes' review inbox. The model answer is not injected until the user runs an explicit accept command.

## Flow

1. In Hermes, run `/connectchar new` to create a one-time code (10-minute expiry).
2. Open a supported, signed-in assistant page and click the Connect Char extension.
3. Enter the code, paste the project prompt, and press `Send to active page`.
4. Leave that assistant tab open. The extension watches for a stable final answer and submits it to the relay.
5. In Hermes, run `/connectchar inbox`, inspect with `/connectchar show <result-id>`, then explicitly accept with `/connectchar accept <result-id> [your added instruction]`.

`accept` injects the answer into the current Hermes chat as a user message, clearly delimited as untrusted external content. Nothing is automatically injected or executed. Hermes may start a new turn after explicit acceptance.

## Render configuration

The relay is the private repo `samansarmasik-alt/connect-char-relay`; its root has a `render.yaml` Blueprint. The live service is `https://connect-char-relay.onrender.com`.

Gerekli Render değişkenleri:

- `EXTENSION_ORIGINS`: popup'ta görünen exact `chrome-extension://<extension-id>` origin. `*` kullanma.
- `DATA_DIR` isteğe bağlı: Render kalıcı diskini `/var/data` konumuna bağlayıp burada belirt. Yoksa servis restart'ında bekleyen yanıtlar kaybolabilir.

`CONNECT_CHAR_ADMIN_TOKEN` yeni akışta gerekmez; sadece eski global API yolları için opsiyonel kalmıştır.

## Local setup

1. In Chrome, open `chrome://extensions`, enable Developer mode, and choose Load unpacked. Select this repository's `extension/` folder.
2. Open the Connect Char popup and copy the exact `chrome-extension://...` origin. Set that value in Render's `EXTENSION_ORIGINS` variable, then redeploy the relay.
3. `/connectchar new` creates an automatically scoped session capability in Hermes plugin state; no admin secret needs to be configured in Windows or the extension.
4. Install or update the Hermes plugin from a fresh terminal:

   `hermes plugins install samansarmasik-alt/connect-char --enable`

   If already installed: `hermes plugins update connect-char`. Verify with `hermes plugins list --json` and `hermes plugins show connect-char`, then open a fresh Hermes CLI so its slash-command registry is loaded.

The extension stores its per-pair browser token in `chrome.storage.local`; the Hermes session capability is stored only in Hermes plugin state and is never sent to the extension. The relay retains unaccepted answers for up to three days and claimed sessions for 24 hours.

## Supported pages and limits

- ChatGPT: `chatgpt.com` and `chat.openai.com`
- Gemini: `gemini.google.com`
- DeepSeek: `chat.deepseek.com`
- Claude: `claude.ai`

The provider UIs can change their DOM; if a prompt box or response selector changes, the extension reports that it could not find the control instead of guessing. Use a normal visible chat tab and press Send yourself through the popup. Maximum prompt size is 180 KiB; maximum answer size is 256 KiB. Completion is inferred from a stable response and the provider's stop-generation control; keep the tab open until the extension badge indicates a queued result.

## Development and tests

Node.js 22+ and Python 3.11+; no npm runtime dependencies.

- `npm test` — extension/API/content tests
- `python -m unittest discover -s hermes-plugin/tests -v` — Hermes plugin tests using a real loopback HTTP relay fixture
- `npm run test:all` — both suites

The tests verify protocol calls and review gating. They do not prove the providers' live DOM selectors remain current; that requires a manual test in each signed-in web UI.
