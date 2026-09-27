// api/parse-recipe.js
//
// A tiny serverless function (deployed on Vercel) that accepts pasted recipe
// text and/or a screenshot, sends it to Claude with instructions to extract
// it into this project's recipe schema, and returns the structured result.
//
// The Anthropic API key lives ONLY in this server-side environment variable
// (ANTHROPIC_API_KEY, set in your Vercel project settings) — it is never
// sent to or visible from the browser.

function buildSystemPrompt(scaleToFour) {
  const servingsRule = scaleToFour
    ? `- Scale every ingredient quantity so the recipe yields exactly 4 servings. If the source states a
  different yield (e.g. "makes 8 servings" or "makes 12 pieces"), scale ingredient quantities
  proportionally, rounding to sensible kitchen fractions (1/4, 1/3, 1/2, 2/3, 3/4). If no serving size
  is stated, assume the recipe as written already serves about 4 and do not change quantities. Set
  "servings" to 4.`
    : `- Do NOT scale or change any ingredient quantities — keep the recipe exactly as written. Determine
  the actual number of servings the recipe as written makes (from an explicit statement in the source,
  or your best estimate from the quantities and dish type if none is stated), and set "servings" to
  that number.`;

  return `You are a recipe formatter for a personal meal-prep recipe database.
Given raw recipe text and/or a screenshot of a recipe, extract it into this exact JSON shape.
Do your arithmetic first in plain text (see the macro-accuracy rule below), then finish your
response with the JSON object as the very last thing you output — no markdown fences around it,
no commentary after it.

{
  "title": string,
  "category": one of ["breakfast","chicken","red_meat","fish_seafood","vegetarian","dessert","sides","snacks","marinades_sauces","butters"],
  "description": string (one appetizing sentence, in the voice of a recipe book subtitle),
  "servings": number (how many servings the ingredients/instructions in this JSON actually make),
  "macros": {"calories": number, "protein_g": number, "carbs_g": number, "fat_g": number} or null,
  "ingredients": array of strings (each a full ingredient line, e.g. "1.5 lb chicken breast, cubed"),
  "instructions": array of strings (each one step, without a leading number),
  "tip": string or null
}

Rules:
${servingsRule}
- macros must be null ONLY for "marinades_sauces" and "butters" (condiments, not standalone
  servings). For every other category, always provide a best-effort macro estimate per serving.
- IMPORTANT — macro accuracy: before writing the JSON, work through the arithmetic in plain text.
  For each ingredient in the final ingredients list (after any scaling from the rule above), estimate
  its calories/protein/carbs/fat at the quantity actually used. Add these up to get totals for the
  whole recipe. Then divide those totals by "servings" to get the per-serving macro values that go in
  the JSON. Show this work briefly. The most common mistake here is computing macros for the wrong
  serving size (e.g. from the original yield instead of the scaled one) — the ingredients list, the
  "servings" number, and the macros must all describe the exact same batch.
- category reflects the dominant protein: chicken/turkey -> "chicken"; beef/pork/lamb ->
  "red_meat"; fish/shrimp/seafood -> "fish_seafood"; no meat and savory -> "vegetarian"; no meat
  and sweet -> "dessert"; a liquid marinade -> "marinades_sauces"; a compound butter -> "butters";
  a starchy/vegetable side with no dominant protein -> "sides"; a small snack-sized item ->
  "snacks"; any other sweet treat -> "dessert".
- If a dish has two or more genuinely co-equal proteins, pick whichever is used in the largest
  quantity by weight.
- Write the tip as one specific, practical cooking tip — not a generic platitude. If nothing
  genuinely useful comes to mind, set tip to null.
- Match a clean, concise, professionally-written recipe book voice.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, imageBase64, imageMediaType, scaleToFour } = req.body || {};
  if (!text && !imageBase64) {
    return res.status(400).json({ error: 'Provide recipe text and/or an image.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY. Add it in your Vercel project settings.' });
  }

  const shouldScaleToFour = scaleToFour !== false; // default true

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
        max_tokens: 6000,
        thinking: { type: 'disabled' }, // reasoning is done as plain visible text instead, so we can extract it
        system: buildSystemPrompt(shouldScaleToFour),
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
      return res.status(502).json({
        error: `Claude returned no text content (stop_reason: ${data.stop_reason || 'unknown'}).`,
        raw: JSON.stringify(data),
      });
    }

    let jsonStr = textBlock.text.trim();
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');

    // The model may write reasoning before the JSON now, so pull out just the final object.
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    let recipe;
    try {
      recipe = JSON.parse(jsonStr);
    } catch (e) {
      return res.status(502).json({
        error: 'Could not parse the model output as JSON.',
        raw: jsonStr,
        stop_reason: data.stop_reason,
      });
    }

    return res.status(200).json({ recipe });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
}
