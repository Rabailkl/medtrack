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
    console.error('GEMINI_API_KEY not set');
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch(e) {
    console.error('Body parse error:', e.message);
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Extract image and text from Anthropic-style message format
  const parts = body.messages[0].content;
  const imageBlock = parts.find(b => b.type === 'image');
  const textBlock  = parts.find(b => b.type === 'text');

  if (!imageBlock || !textBlock) {
    console.error('Missing image or text block in request');
    return new Response(JSON.stringify({ error: 'Missing image or text' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // b64 is already raw base64 (no data URL prefix) — stripped in the app
  const b64 = imageBlock.source.data;
  const mimeType = imageBlock.source.media_type || 'image/jpeg';

  console.log('Image mime type:', mimeType);
  console.log('b64 length:', b64.length);
  console.log('b64 starts with:', b64.slice(0, 30));

  const geminiPayload = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: b64,
          }
        },
        { text: textBlock.text }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1500,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ]
  };

  // Use gemini-1.5-pro for better handwriting / mixed language OCR
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;

  console.log('Calling Gemini API...');

  let geminiData;
  try {
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload),
    });

    geminiData = await response.json();
    console.log('Gemini status:', response.status);
    console.log('Gemini response:', JSON.stringify(geminiData, null, 2));
  } catch(fetchErr) {
    console.error('Gemini fetch error:', fetchErr.message);
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Check for Gemini-level errors
  if (geminiData.error) {
    console.error('Gemini API error:', JSON.stringify(geminiData.error));
    return new Response(JSON.stringify({ error: geminiData.error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  // Check for blocked response
  const candidate = geminiData?.candidates?.[0];
  if (!candidate) {
    console.error('No candidates in Gemini response. promptFeedback:', JSON.stringify(geminiData?.promptFeedback));
    return new Response(JSON.stringify({ error: 'No response from Gemini', debug: geminiData }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  if (candidate.finishReason === 'SAFETY') {
    console.error('Gemini blocked by safety filter');
    return new Response(JSON.stringify({ error: 'Blocked by safety filter' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }

  const text = candidate?.content?.parts?.[0]?.text || '[]';
  console.log('Extracted text:', text);

  // Return in Anthropic-compatible format so app code needs no changes
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
