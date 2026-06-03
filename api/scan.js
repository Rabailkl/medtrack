const https = require('https');

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  console.log('API key present:', !!apiKey);
  console.log('API key length:', apiKey ? apiKey.length : 0);

  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    return;
  }

  // Vercel parses JSON bodies automatically, but guard for string bodies too
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
  }

  let parts, imgBlk, txtBlk;
  try {
    parts  = body.messages[0].content;
    imgBlk = parts.find(b => b.type === 'image');
    txtBlk = parts.find(b => b.type === 'text');
  } catch (e) {
    res.status(400).json({ error: 'Malformed request body' });
    return;
  }

  const geminiPayload = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: imgBlk.source.media_type, data: imgBlk.source.data } },
        { text: txtBlk.text }
      ]
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ]
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(geminiPayload),
      },
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        console.log('Gemini HTTP status:', apiRes.statusCode);
        console.log('Gemini raw response:', data.slice(0, 500));

        let geminiData;
        try {
          geminiData = JSON.parse(data);
        } catch (e) {
          res.status(500).json({ error: 'Failed to parse Gemini response', raw: data.slice(0, 200) });
          resolve();
          return;
        }

        if (geminiData.error) {
          console.error('Gemini error:', JSON.stringify(geminiData.error));
          res.status(500).json({ error: geminiData.error.message });
          resolve();
          return;
        }

        const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        console.log('Extracted text:', text.slice(0, 300));

        res.status(200).json({ content: [{ type: 'text', text }] });
        resolve();
      });
    });

    apiReq.on('error', (err) => {
      console.error('HTTPS request error:', err.message);
      res.status(500).json({ error: err.message });
      resolve();
    });

    apiReq.write(geminiPayload);
    apiReq.end();
  });
};
