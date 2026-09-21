// api/parse-recipe.js
//
// A tiny serverless function (deployed on Vercel) that accepts pasted recipe
// text and/or a screenshot, sends it to Claude with instructions to extract
// it into this project's recipe schema, and returns the structured result.
//
// The Anthropic API key lives ONLY in this server-side environment variable
// (ANTHROPIC_API_KEY, set in your Vercel project settings) — it is never
// sent to or visible from the browser.

const SYSTEM_PROMPT = `You are a recipe formatter for a personal meal-prep recipe database.
Given raw recipe text and/or a screenshot of a recipe, extract it into this exact JSON shape
and return ONLY the JSON object — no markdown fences, no commentary, nothing else.

{
  "title": string,
  "category": one of ["breakfast","chicken","red_meat","fish_seafood","vegetarian","dessert","sides","snacks","marinades_sauces","butters"],
  "description": string (one appetizing sentence, in the voice of a recipe book subtitle),
  "macros": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number} or null,
  "ingredients": array of strings (each a full ingredient line, e.g. "1.5 lb chicken breast, cubed"),
  "instructions": array of strings (each one step, without a leading number),
  "tip": string or null
}

Rules:
- Every recipe must be scaled to make exactly 4 servings. If the source states a different yield
  (e.g. "makes 8 servings" or "makes 12 pieces"), scale ingredient quantities proportionally so it
  yields 4 servings, rounding to sensible kitchen fractions (1/4, 1/3, 1/2, 2/3, 3/4), and give
  macros as accurate per-serving values for those 4 servings.
- If no serving size is stated, assume the recipe as written already serves about 4.
- macros must be null ONLY for "marinades_sauces" and "butters" (condiments, not standalone
  servings). For every other category, always provide a best-effort macro estimate per serving
  based on standard nutrition data for the ingredients and quantities used, even if the source
  doesn't state one.
- category reflects the dominant protein: chicken/turkey -> "chicken"; beef/pork/lamb ->
  "red_meat"; fish/shrimp/seafood -> "fish_seafood"; no meat and savory -> "vegetarian"; no meat
  and sweet -> "dessert"; a liquid marinade -> "marinades_sauces"; a compound butter -> "butters";
  a starchy/vegetable side with no dominant protein -> "sides"; a small snack-sized item ->
  "snacks"; any other sweet treat -> "dessert".
- If a dish has two or more genuinely co-equal proteins, pick whichever is used in the largest
  quantity by weight.
- Write the tip as one specific, practical cooking tip — not a generic platitude. If nothing
  genuinely useful comes to mind, set tip to null.
- Match a clean, concise, professionally-written recipe book voice.

Return ONLY the JSON object.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, imageBase64, imageMediaType } = req.body || {};
  if (!text && !imageBase64) {
    return res.status(400).json({ error: 'Provide recipe text and/or an image.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in your Vercel project settings.' });
  }

  const content = [];
  if (imageBase64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: imageMediaType || 'image/png', data: imageBase64 },
    });
  }
  content.push({
    type: 'text',
    text: text
      ? `Recipe text (and screenshot above, if provided):\n\n${text}`
      : 'Extract the recipe from the screenshot above.',
  });

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(502).json({ error: `Claude API error (${apiRes.status}): ${errText}` });
    }

    const data = await apiRes.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'Claude returned no text content.' });
    }

    let jsonStr = textBlock.text.trim();
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');

    let recipe;
    try {
      recipe = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(502).json({ error: 'Could not parse the model output as JSON.', raw: jsonStr });
    }

    return res.status(200).json({ recipe });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
