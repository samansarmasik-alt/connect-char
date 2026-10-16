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

The relay source remains in the private repo `samansarmasik-alt/connect-char-relay`; its hosted API at `https://connect-char-relay.onrender.com` is public so users of the public extension/plugin can pair their own Hermes sessions.

Render variables:

- `EXTENSION_ORIGINS`: optional comma-separated additional exact origins. Valid Chrome extension origins (`chrome-extension://` + 32 lowercase letters `a`–`p`) are accepted by default and echoed exactly; never use `*`.
- `DATA_DIR`: use only when a paid Render persistent disk is mounted at `/var/data`. Render Free has no persistent disk; relay state can disappear on restart.

The relay self-pings its public `/healthz` URL every 10 minutes. A scheduled GitHub Actions workflow in this public repo also pings every 10 minutes to wake it after restarts. Render Free spins down after 15 minutes without inbound traffic, so these pings reduce cold starts but do not provide an uptime guarantee. Keeping it awake can consume nearly all of Render's shared 750 free instance-hours/month; Free services can still restart and lose pending transfers. For durable production use, use a paid instance with persistent storage or an external database.

`CONNECT_CHAR_ADMIN_TOKEN` is not required for the normal flow; it is optional only for legacy global API routes.

## Local setup

1. In Thorium, open `chrome://extensions`, enable Developer mode, and choose Load unpacked. Select this repository's `extension/` folder.
2. The public relay accepts any syntactically valid Chrome extension ID and reflects only that exact origin, so unpacked installs do not need a per-user allowlist change.
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
