const HOSTS = Object.freeze({
  chatgpt: ['chatgpt.com', 'chat.openai.com'],
  gemini: ['gemini.google.com'],
  deepseek: ['chat.deepseek.com'],
  claude: ['claude.ai'],
});

export const SUPPORTED_PROVIDERS = Object.freeze(Object.keys(HOSTS));

export function detectProvider(input) {
  let hostname;
  try {
    hostname = new URL(input).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [provider, domains] of Object.entries(HOSTS)) {
    if (domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return provider;
  }
  return null;
}

export function isProviderHost(provider, input) {
  return detectProvider(input) === provider;
}
