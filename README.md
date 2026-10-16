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

Required Render environment variables:

- `CONNECT_CHAR_ADMIN_TOKEN`: random secret of at least 32 characters. Keep it server-side and in the local Hermes environment only; never put it in this repository or the extension.
- `EXTENSION_ORIGINS`: the exact extension origin shown in the popup, for example `chrome-extension://<extension-id>`. Do not use `*`. Save the setting and redeploy.

For persistent relay state, mount a Render persistent disk at `/var/data` and set `DATA_DIR=/var/data`. Without persistent storage, a service restart may discard active pairings and pending answers. Keep the relay at one instance because the file store is single-instance.

## Local setup

1. In Chrome, open `chrome://extensions`, enable Developer mode, and choose Load unpacked. Select this repository's `extension/` folder.
2. Open the Connect Char popup and copy the exact `chrome-extension://...` origin. Set that value in Render's `EXTENSION_ORIGINS` variable, then redeploy the relay.
3. Store the same `CONNECT_CHAR_ADMIN_TOKEN` that is configured in Render in the local Windows user environment. Use Hermes' masked `secure_env_input` prompt; do not paste the secret into chat or save it in Git.
4. Install the Hermes plugin from a fresh terminal:

   `hermes plugins install samansarmasik-alt/connect-char --enable`

   Verify with `hermes plugins list --json` and `hermes plugins show connect-char`, then open a fresh Hermes CLI so its slash-command registry is loaded.

The extension stores its per-pair browser token in `chrome.storage.local`. It never receives the Hermes admin token. The relay retains unaccepted answers for up to three days and claimed sessions for 24 hours.

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
