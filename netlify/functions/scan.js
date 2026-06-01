const https = require('https');

exports.handler = async function(event, context) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  console.log('API key present:', !!apiKey);
  console.log('API key length:', apiKey ? apiKey.length : 0);

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const parts  = body.messages[0].content;
  const imgBlk = parts.find(b => b.type === 'image');
  const txtBlk = parts.find(b => b.type === 'text');

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

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Gemini HTTP status:', res.statusCode);
        console.log('Gemini raw response:', data.slice(0, 500));

        let geminiData;
        try { geminiData = JSON.parse(data); }
        catch(e) {
          resolve({
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Failed to parse Gemini response', raw: data.slice(0,200) }),
          });
          return;
        }

        if (geminiData.error) {
          console.error('Gemini error:', JSON.stringify(geminiData.error));
          resolve({
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: geminiData.error.message }),
          });
          return;
        }

        const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
        console.log('Extracted text:', text.slice(0, 300));

        resolve({
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ content: [{ type: 'text', text }] }),
        });
      });
    });

    req.on('error', (err) => {
      console.error('HTTPS request error:', err.message);
      resolve({
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: err.message }),
      });
    });

    req.write(geminiPayload);
    req.end();
  });
};
