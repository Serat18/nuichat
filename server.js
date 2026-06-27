const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// models.dev provider ID mapping (their IDs → our provider keys)
const MODELSDEV_ID = {
  openrouter: 'openrouter',
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  groq: 'groq',
  deepseek: 'deepseek',
  mistral: 'mistral',
  together: 'togetherai',
  fireworks: 'fireworks',
  xai: 'xai',
  cerebras: 'cerebras',
  perplexity: 'perplexity',
  nvidia: 'nvidia',
  cohere: 'cohere',
  huggingface: 'huggingface',
  deepinfra: 'deepinfra',
};

// Cache models.dev data for 1 hour
let modelsDevCache = null;
let modelsDevFetchedAt = 0;

async function getModelsDev() {
  if (modelsDevCache && Date.now() - modelsDevFetchedAt < 3600_000) return modelsDevCache;
  try {
    const res = await fetch('https://models.dev/api.json');
    modelsDevCache = await res.json();
    modelsDevFetchedAt = Date.now();
    console.log('[models.dev] fetched', Object.keys(modelsDevCache).length, 'providers');
    return modelsDevCache;
  } catch(e) {
    console.error('[models.dev] fetch failed:', e.message);
    return null;
  }
}

// Provider definitions
const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
    extraHeaders: () => ({ 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Nuichat' }),
  },
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id',
      filter: models => models.filter(m => /gpt|o1|o3|o4|chatgpt/.test(m.id)) },
  },
  anthropic: {
    name: 'Anthropic',
    baseURL: 'https://api.anthropic.com',
    isAnthropic: true,
    liveModels: { path: '/v1/models', key: 'data', idKey: 'id' },
  },
  google: {
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    liveModels: { path: '/models', key: 'data', idKey: 'id',
      filter: models => models.filter(m => m.id.startsWith('gemini')) },
  },
  groq: {
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  deepseek: {
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  mistral: {
    name: 'Mistral AI',
    baseURL: 'https://api.mistral.ai/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  together: {
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    liveModels: { path: '/models', key: null, idKey: 'id' },
  },
  fireworks: {
    name: 'Fireworks AI',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  xai: {
    name: 'xAI (Grok)',
    baseURL: 'https://api.x.ai/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  cerebras: {
    name: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  perplexity: {
    name: 'Perplexity',
    baseURL: 'https://api.perplexity.ai',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  nvidia: {
    name: 'NVIDIA NIM',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  cohere: {
    name: 'Cohere',
    baseURL: 'https://api.cohere.com/compatibility/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  huggingface: {
    name: 'Hugging Face',
    baseURL: 'https://api-inference.huggingface.co/v1',
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  deepinfra: {
    name: 'Deep Infra',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    liveModels: { path: '/models', key: 'data', idKey: 'id',
      filter: models => models.filter(m => !m.id.includes('embed')) },
  },
  ollama: {
    name: 'Ollama (Local)',
    baseURL: 'http://localhost:11434/v1',
    noAuth: true,
    liveModels: { path: '/models', key: 'data', idKey: 'id' },
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    noAuth: true, // key is optional
    isCustom: true,
  },
};

function getProviderHeaders(providerKey, apiKey) {
  const provider = PROVIDERS[providerKey];
  const headers = { 'Content-Type': 'application/json' };
  if (provider.isAnthropic) {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (!provider.noAuth) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (provider.extraHeaders) Object.assign(headers, provider.extraHeaders(apiKey));
  return headers;
}

// Get models — try models.dev first (no auth needed), fall back to live provider API
app.get('/api/models/:provider', async (req, res) => {
  const providerKey = req.params.provider;
  const provider = PROVIDERS[providerKey];
  if (!provider) return res.status(404).json({ error: 'Unknown provider' });

  const apiKey = req.headers['x-api-key'];

  // Ollama: always hit live local API
  if (providerKey === 'ollama') {
    try {
      const r = await fetch(`${provider.baseURL}/models`);
      const data = await r.json();
      const models = (data.data || []).map(m => ({ id: m.id }));
      return res.json({ models });
    } catch(e) {
      return res.json({ models: [], error: 'Ollama not running locally' });
    }
  }

  // OpenRouter: always use its own live API (huge list, models.dev subset is small)
  if (providerKey === 'openrouter') {
    if (!apiKey) return res.status(400).json({ error: 'API key required' });
    try {
      const headers = getProviderHeaders('openrouter', apiKey);
      const r = await fetch(`${provider.baseURL}/models`, { headers });
      const data = await r.json();
      const models = (data.data || []).map(m => ({ id: m.id, name: m.name }))
        .sort((a, b) => a.id.localeCompare(b.id));
      return res.json({ models });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // Try models.dev first
  const mdKey = MODELSDEV_ID[providerKey];
  if (mdKey) {
    const db = await getModelsDev();
    if (db && db[mdKey]) {
      const providerData = db[mdKey];
      const models = Object.keys(providerData.models || {})
        .map(id => ({ id, name: providerData.models[id].name || id }))
        .sort((a, b) => a.id.localeCompare(b.id));
      if (models.length > 0) return res.json({ models });
    }
  }

  // Fall back to live provider API
  if (!apiKey && !provider.noAuth) return res.status(400).json({ error: 'API key required' });
  try {
    const lm = provider.liveModels;
    const headers = getProviderHeaders(providerKey, apiKey);
    const r = await fetch(`${provider.baseURL}${lm.path}`, { headers });
    const data = await r.json();
    let models = lm.key === null ? data : (data[lm.key] || []);
    if (lm.filter) models = lm.filter(models);
    return res.json({
      models: models.map(m => ({ id: m[lm.idKey] })).sort((a, b) => a.id.localeCompare(b.id))
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Return provider list
app.get('/api/providers', (req, res) => {
  res.json(Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name, noAuth: !!p.noAuth })));
});

// Chat completion with retry
app.post('/api/chat', async (req, res) => {
  const { messages, model, apiKey, provider: providerKey, customBaseUrl } = req.body;
  const provider = PROVIDERS[providerKey];
  if (!provider) return res.status(400).json({ error: 'Unknown provider' });
  if (!apiKey && !provider.noAuth) return res.status(400).json({ error: 'API key required' });

  // Custom provider: use the user-supplied base URL
  if (provider.isCustom) {
    if (!customBaseUrl) return res.status(400).json({ error: 'Custom base URL required' });
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const chatURL = `${customBaseUrl.replace(/\/$/, '')}/chat/completions`;
    const body = JSON.stringify({ model, messages, stream: true });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for (let attempt = 0; ; attempt++) {
      let r;
      try { r = await fetch(chatURL, { method: 'POST', headers, body }); }
      catch(e) { res.write(`data: {"type":"error","message":${JSON.stringify(e.message)}}\n\n`); return res.end(); }

      if (r.status === 429) {
        const retryAfter = r.headers.get('retry-after');
        const wait = retryAfter ? parseFloat(retryAfter) * 1000 : Math.min(1000 * 2 ** attempt, 60000);
        console.log(`[rate limit][custom] attempt ${attempt + 1} — waiting ${(wait/1000).toFixed(1)}s`);
        res.write(`data: {"type":"rate_limit","wait":${wait},"attempt":${attempt + 1}}\n\n`);
        await sleep(wait);
        continue;
      }

      if (!r.ok) { const e = await r.text(); res.write(`data: {"type":"error","message":${JSON.stringify(e)}}\n\n`); return res.end(); }

      try {
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value));
        }
      } catch(e) { res.write(`data: {"type":"error","message":${JSON.stringify(e.message)}}\n\n`); }
      return res.end();
    }
  }

  const headers = getProviderHeaders(providerKey, apiKey);

  // Anthropic uses a different request format
  let chatURL, body;
  if (provider.isAnthropic) {
    chatURL = `${provider.baseURL}/v1/messages`;
    const sysMsg = messages.find(m => m.role === 'system');
    const userMsgs = messages.filter(m => m.role !== 'system');
    body = JSON.stringify({
      model,
      max_tokens: 8096,
      stream: true,
      ...(sysMsg ? { system: sysMsg.content } : {}),
      messages: userMsgs,
    });
  } else {
    chatURL = `${provider.baseURL}/chat/completions`;
    body = JSON.stringify({ model, messages, stream: true });
  }

  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(chatURL, { method: 'POST', headers, body });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const wait = retryAfter
        ? parseFloat(retryAfter) * 1000
        : Math.min(1000 * 2 ** attempt, 60000); // cap at 60s
      console.log(`[rate limit] attempt ${attempt + 1} — waiting ${(wait/1000).toFixed(1)}s`);
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
      }
      res.write(`data: {"type":"rate_limit","wait":${wait},"attempt":${attempt + 1}}\n\n`);
      await sleep(wait);
      continue;
    }

    if (!response.ok) {
      const err = await response.text();
      if (!res.headersSent) return res.status(response.status).json({ error: err });
      res.write(`data: {"type":"error","message":${JSON.stringify(err)}}\n\n`);
      return res.end();
    }

    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    }

    // Anthropic SSE needs to be normalized to OpenAI format for the frontend
    if (provider.isAnthropic) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') { res.write('data: [DONE]\n\n'); continue; }
            try {
              const json = JSON.parse(raw);
              // Normalize Anthropic delta to OpenAI format
              if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                const normalized = { choices: [{ delta: { content: json.delta.text } }] };
                res.write(`data: ${JSON.stringify(normalized)}\n\n`);
              }
              if (json.type === 'message_stop') res.write('data: [DONE]\n\n');
            } catch {}
          }
        }
      } catch(e) { /* client disconnected */ }
      return res.end();
    }

    // OpenAI-compatible: pass through directly
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value));
      }
    } catch(e) { /* client disconnected */ }
    return res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n✅ Nuichat running at http://localhost:${PORT}\n`));
