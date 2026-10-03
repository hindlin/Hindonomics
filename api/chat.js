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

    // Try models in order — smaller ones have higher TPM limits
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
    // Trim system prompt to reduce token usage
    if (system) groqMessages.push({ role: 'system', content: system.substring(0, 1500) });
    // Only send last 6 messages to reduce token count
    const recentMessages = messages.slice(-6);
    recentMessages.forEach(m => groqMessages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.substring(0, 800)
    }));

    let lastError = null;
    for (const model of modelQueue) {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify({
          model: model,
          messages: groqMessages,
          max_tokens: 600,
          temperature: 0.7
        })
      });

      const data = await response.json();

      if (response.ok) {
        const text = data.choices[0].message.content;
        res.status(200).json({ content: [{ type: 'text', text: text }] });
        return;
      }

      // If rate limited, try next model
      if (data?.error?.code === 'rate_limit_exceeded' || data?.error?.code === 'model_not_found') {
        lastError = data;
        continue;
      }

      // Other error — return it
      res.status(500).json({ error: JSON.stringify(data) });
      return;
    }

    // All models failed
    res.status(429).json({
      content: [{ type: 'text', text: '⚠️ The AI is busy right now (rate limit reached). Please wait 10 seconds and try again!' }]
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
