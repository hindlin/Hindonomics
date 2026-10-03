module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const key = process.env.GROQ_API_KEY;
  if (!key) { res.status(500).json({ error: 'GROQ_API_KEY is not set' }); return; }

  try {
    // Step 1: get live model list from this account
    const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': 'Bearer ' + key }
    });
    const modelsData = await modelsRes.json();
    const modelIds = modelsData.data ? modelsData.data.map(m => m.id) : [];

    // Step 2: pick best available chat model
    // Prefer smaller/faster models first to avoid TPM limits
    const preferred = [
      'openai/gpt-oss-20b',
      'qwen/qwen3.8-27b',
      'qwen/qwen3-32b',
      'openai/gpt-oss-120b',
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'allam-2-7b'
    ];

    // Filter to only chat-capable models (exclude whisper, guard models)
    const chatModels = modelIds.filter(id =>
      !id.includes('whisper') &&
      !id.includes('guard') &&
      !id.includes('safeguard') &&
      !id.includes('orpheus') &&
      !id.includes('prompt-guard')
    );

    const model = preferred.find(m => chatModels.includes(m)) || chatModels[0];

    if (!model) {
      res.status(500).json({ error: 'No usable chat models found', available: modelIds });
      return;
    }

    const { messages, system } = req.body;
    const groqMessages = [];
    if (system) groqMessages.push({ role: 'system', content: system });
    messages.forEach(m => groqMessages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content
    }));

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify({
        model: model,
        messages: groqMessages,
        max_tokens: 800,
        temperature: 0.7
      })
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(500).json({ error: JSON.stringify(data), model_tried: model });
      return;
    }

    const text = data.choices[0].message.content;
    res.status(200).json({ content: [{ type: 'text', text: text }] });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
