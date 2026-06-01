export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Convert Anthropic message format to Gemini format
  const anthropicMsg = body.messages[0].content;
  const imageBlock = anthropicMsg.find(b => b.type === 'image');
  const textBlock  = anthropicMsg.find(b => b.type === 'text');

  const geminiPayload = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: imageBlock.source.media_type,
            data: imageBlock.source.data,
          }
        },
        { text: textBlock.text }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1200,
    }
  };

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiPayload),
  });

  const geminiData = await response.json();

  // Convert Gemini response back to Anthropic format so the app code stays the same
  const text = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  const anthropicFormat = {
    content: [{ type: 'text', text }]
  };

  return new Response(JSON.stringify(anthropicFormat), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
};
