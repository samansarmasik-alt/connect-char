# Connect Char

Connect Char pairs a browser extension with a Hermes session through `https://connect-char-relay.onrender.com`. One click asks the active ChatGPT, Gemini, DeepSeek, or Claude conversation to create a self-contained project handoff; the completed handoff is sent to Hermes' review inbox. It summarizes the accessible conversation rather than exporting a raw transcript. The model answer is not injected until the user runs an explicit accept command.

## Flow

1. In Hermes, run `/connectchar new` to create a one-time code (10-minute expiry).
2. Open a supported, signed-in assistant page and click the Connect Char extension.
3. In the popup, press `Prepare handoff & send`; no project prompt needs to be typed or pasted.
4. Leave that assistant tab open. It creates a project handoff from the accessible thread and submits the result to the relay.
5. In Hermes, run `/connectchar inbox`, inspect with `/connectchar show <result-id>`, then explicitly accept with `/connectchar accept <result-id> [your added instruction]`.

`accept` injects the answer into the current Hermes chat as a user message, clearly delimited as untrusted external content. Nothing is automatically injected or executed. Hermes may start a new turn after explicit acceptance.

## Render configuration

The relay is the private repo `samansarmasik-alt/connect-char-relay`; its root has a `render.yaml` Blueprint. The live service is `https://connect-char-relay.onrender.com`.

Render variables:

- `EXTENSION_ORIGINS`: optional comma-separated exact extension origins. The shipped Thorium extension origin is preconfigured; never use `*`.
- `DATA_DIR` optional: mount Render persistent disk at `/var/data` and set this path. Without it, pending answers can be lost on service restart.

`CONNECT_CHAR_ADMIN_TOKEN` yeni akışta gerekmez; sadece eski global API yolları için opsiyonel kalmıştır.

## Local setup

1. In Thorium, open `chrome://extensions`, enable Developer mode, and choose Load unpacked. Select this repository's `extension/` folder.
2. The shipped extension origin is already allowlisted by the relay. If Thorium assigns a different ID, add its exact origin to `EXTENSION_ORIGINS` and redeploy.
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

The popup's `Prepare handoff & send` button submits a built-in instruction asking the active assistant to summarize the entire accessible thread for Hermes CLI; it does not transfer a raw transcript. The handoff is queued for review and still requires explicit `/connectchar accept`. Keep the provider tab open until the extension badge indicates a queued result. Provider UIs can change their DOM, so composer selectors have provider-specific fallbacks; maximum generated answer size is 256 KiB. Completion is inferred from a stable response and the provider's stop-generation control.

## Development and tests

Node.js 22+ and Python 3.11+; no npm runtime dependencies.

- `npm test` — extension/API/content tests
- `python -m unittest discover -s hermes-plugin/tests -v` — Hermes plugin tests using a real loopback HTTP relay fixture
- `npm run test:all` — both suites

The tests verify protocol calls and review gating. They do not prove the providers' live DOM selectors remain current; that requires a manual test in each signed-in web UI.
