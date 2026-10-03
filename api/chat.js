module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const key = process.env.GROQ_API_KEY;
  if (!key) { res.status(500).json({ error: 'GROQ_API_KEY is not set' }); return; }

  try {
    // Get live model list
    const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': 'Bearer ' + key }
    });
    const modelsData = await modelsRes.json();
    const modelIds = modelsData.data ? modelsData.data.map(m => m.id) : [];

    // Filter to chat-capable models only
    const chatModels = modelIds.filter(id =>
      !id.includes('whisper') && !id.includes('guard') &&
      !id.includes('safeguard') && !id.includes('orpheus') &&
      !id.includes('prompt-guard')
    );

    const preferred = [
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
      'qwen/qwen3-32b',
      'allam-2-7b',
      'openai/gpt-oss-120b',
    ];
    const modelQueue = [
      ...preferred.filter(m => chatModels.includes(m)),
      ...chatModels.filter(m => !preferred.includes(m))
    ];

    const { messages, system } = req.body;
    const groqMessages = [];

    // System prompt — keep full but cap at 3000 chars to save tokens
    if (system) {
      groqMessages.push({ role: 'system', content: system.substring(0, 3000) });
    }

    // Only send last 6 messages to reduce token count
    const recentMessages = (messages || []).slice(-6);
    recentMessages.forEach(m => groqMessages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').substring(0, 1000)
    }));

    let lastError = null;
    for (const model of modelQueue) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key
          },
          body: JSON.stringify({
            model: model,
            messages: groqMessages,
            max_tokens: 1200,
            temperature: 0.7
          })
        });

        const data = await response.json();

        if (response.ok) {
          const text = data.choices[0].message.content;
          res.status(200).json({ content: [{ type: 'text', text: text }] });
          return;
        }

        lastError = data;

        // Only retry on rate limit or model not found
        const code = data?.error?.code || '';
        if (code === 'rate_limit_exceeded' || code === 'model_not_found' || code === 'model_terms_required') {
          continue;
        }

        // Any other error — return immediately
        res.status(500).json({ error: JSON.stringify(data) });
        return;

      } catch (innerErr) {
        lastError = { message: innerErr.message };
        continue;
      }
    }

    // All models failed — return friendly message
    res.status(200).json({
      content: [{ type: 'text', text: '⚠️ The AI is busy right now. Please wait 15 seconds and try again!' }]
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
