module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'GROQ_API_KEY is not set' });
    return;
  }

  // First: get list of available models from this account
  try {
    const modelsRes = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': 'Bearer ' + key }
    });
    const modelsData = await modelsRes.json();
    const modelIds = modelsData.data ? modelsData.data.map(m => m.id) : [];

    // Pick first available chat model
    const preferred = ['llama-3.3-70b-versatile','llama-3.1-70b-versatile','llama3-70b-8192','llama-3.1-8b-instant','llama3-8b-8192','mixtral-8x7b-32768','gemma2-9b-it'];
    const model = preferred.find(m => modelIds.includes(m)) || modelIds[0];

    if (!model) {
      res.status(500).json({ error: 'No models available', available: modelIds });
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
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    const data = await response.json();
    if (!response.ok) {
      res.status(500).json({ error: JSON.stringify(data), model_used: model, available_models: modelIds });
      return;
    }

    const text = data.choices[0].message.content;
    res.status(200).json({ content: [{ type: 'text', text: text }] });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
