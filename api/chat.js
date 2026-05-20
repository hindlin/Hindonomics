
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const { messages, system } = req.body;
    const lastMsg = messages[messages.length - 1].content;
    const prompt = system ? system + '\n\nStudent says: ' + lastMsg : lastMsg;
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + process.env.GEMINI_API_KEY;
    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1000, temperature: 0.7 }
      })
    });
    const geminiData = await geminiRes.json();
    if (!geminiRes.ok) {
      res.status(500).json({ error: JSON.stringify(geminiData) });
      return;
    }
    const text = geminiData.candidates[0].content.parts[0].text;
    res.status(200).json({ content: [{ type: 'text', text: text }] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
