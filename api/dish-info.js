const DEFAULT_OCCASION = "Wedding";
const DEFAULT_TONE =
  "Luxurious 5-star fine-dining language. Make each dish sound magical, rich and mouth-watering with sensory words about aromas, textures and flavours.";

async function callOpenAI(prompt, maxTokens) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("OpenAI error:", data);
    const err = new Error("OpenAI request failed");
    err.status = response.status;
    throw err;
  }
  let text = data.choices?.[0]?.message?.content || "";
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  return JSON.parse(text);
}

function readMood(body) {
  const mood = body.mood || {};
  return {
    occasion: String(mood.name || DEFAULT_OCCASION).slice(0, 80),
    tone: String(mood.tone || DEFAULT_TONE).slice(0, 600),
  };
}

// Fixes only the capital letters of dish names. Spelling and words are never changed.
// Accepts { name } (returns { name }) or { names:[...] } (returns { names:[...] }).
// Any name the AI changed beyond capitals comes back as null, and the app uses simple Title Case.
async function fixName(body, res) {
  const clean = (v) => String(v || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const single = !Array.isArray(body.names);
  const names = (single ? [body.name] : body.names).map(clean).slice(0, 40);
  if (!names.length || names.some((n) => !n)) {
    return res.status(400).json({ error: "name is required" });
  }
  const list = names.map((n, i) => `${i + 1}. ${n}`).join("\n");
  const prompt = `These are names of Indian dishes for a printed catering menu:
${list}

For each one, fix ONLY the capital letters so it reads well on a menu:
- Capitalise each main word (Title Case), e.g. "paneer butter masala" -> "Paneer Butter Masala".
- Keep small joining words lowercase unless they are the first word: and, with, in, of, n.
- Keep short abbreviations in capitals, e.g. BBQ.
- Do NOT change spelling, add, remove or reorder words, or change punctuation and spaces.

Return JSON only, one entry per dish in the same order: {"names":["...","..."]}`;
  const out = await callOpenAI(prompt, 60 + names.length * 30);
  const got = Array.isArray(out.names) ? out.names : out.name ? [out.name] : [];
  const fixed = names.map((orig, i) => {
    const f = clean(got[i]);
    return f && f.toLowerCase() === orig.toLowerCase() ? f : null;
  });
  return res.status(200).json(single ? { name: fixed[0] } : { names: fixed });
}

async function writeThankYou(body, res) {
  const { occasion, tone } = readMood(body);
  const prompt = `You write the closing "thank you" page of a printed Indian catering menu for "Shakti Catering & Events".
Occasion: ${occasion}
Tone: ${tone}

Write:
- "title": a short heading for the page, 1 to 4 words, e.g. "Thank You" or "With Gratitude", suited to the occasion. No quotation marks.
- "text": ONE heartfelt thank-you line of 20 to 35 words, in the tone above, suited to the occasion, thanking the hosts and guests. Do not mention phone numbers or addresses. Plain characters only, no emojis.

Return JSON only: {"title":"...","text":"..."}`;
  const out = await callOpenAI(prompt, 250);
  return res.status(200).json({
    title: String(out.title || "").trim(),
    text: String(out.text || "").trim(),
  });
}

async function writeWelcome(body, res) {
  const { occasion, tone } = readMood(body);
  const prompt = `You write the welcome page of a printed Indian catering menu for "Shakti Catering & Events".
Occasion: ${occasion}
Tone: ${tone}

Write:
- "title": a short cover title, 2 to 6 words, no quotation marks.
- "text": a welcome message of 50 to 80 words, in the tone above, suited to the occasion. Mention Shakti Catering & Events once. Plain characters only, no emojis.

Return JSON only: {"title":"...","text":"..."}`;
  const out = await callOpenAI(prompt, 400);
  return res.status(200).json({
    title: String(out.title || "").trim(),
    text: String(out.text || "").trim(),
  });
}

// Translates menu text into Hindi (Devanagari) for the Hindi menu PDF.
// Body: { type:"translate", kind:"dish"|"text", texts:[...] } -> { texts:[...] } (same order, "" when unsure)
async function translateHindi(body, res) {
  const clean = (v) => String(v || "").replace(/[ \t]+/g, " ").trim().slice(0, 900);
  const texts = (Array.isArray(body.texts) ? body.texts : []).map(clean).slice(0, 40);
  if (!texts.length || texts.some((t) => !t)) {
    return res.status(400).json({ error: "texts is required" });
  }
  const kind = body.kind === "dish" ? "dish" : "text";
  const list = texts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, " \\n ")}`).join("\n");
  const rules =
    kind === "dish"
      ? `These are Indian dish names on a printed catering menu. Write each one in Hindi (Devanagari script) the way Hindi-speaking guests say it.
- If the dish has a well known Hindi name, use it, e.g. "Gulab Jamun" -> "गुलाब जामुन", "Jeera Rice" -> "जीरा राइस".
- Otherwise write the English words in Devanagari letters instead of translating them, e.g. "Paneer Butter Masala" -> "पनीर बटर मसाला", "Veg Manchurian" -> "वेज मंचूरियन", "Cold Coffee" -> "कोल्ड कॉफ़ी".
- Keep it short. No English letters, no explanations.`
      : `These are lines from a printed Indian catering menu or its headings (meal names, section names, greetings, notes, client and place names).
- Translate each into natural, elegant, easy-to-read Hindi in Devanagari script, keeping the same meaning and tone.
- Names of people, places, hotels and brands are written in Devanagari letters (not translated), e.g. "Sri Sanjay Chaparia Ji" -> "श्री संजय चपरिया जी", "Hotel Radisson, Gorakhpur" -> "होटल रेडिसन, गोरखपुर".
- Dish names inside a sentence are written in Devanagari letters as Hindi speakers say them.
- Keep numbers, phone numbers and times as digits (0-9). Keep "||" and similar symbols. " \\n " marks a line break: keep it in the same place.
- No English letters unless it is a code or number. No explanations.`;
  const prompt = `${rules}

Return JSON only, one entry per line in the same order: {"texts":["...","..."]}

Lines:
${list}`;
  const out = await callOpenAI(prompt, 200 + texts.reduce((a, t) => a + t.length * 4, 0));
  const got = Array.isArray(out.texts) ? out.texts : [];
  return res.status(200).json({
    texts: texts.map((_, i) =>
      String(got[i] || "")
        .replace(/\s*\\n\s*/g, "\n")
        .trim()
    ),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    if (body.type === "name") {
      return await fixName(body, res);
    }

    if (body.type === "welcome") {
      return await writeWelcome(body, res);
    }

    if (body.type === "thankyou") {
      return await writeThankYou(body, res);
    }

    if (body.type === "translate") {
      return await translateHindi(body, res);
    }

    // New format: dishes:[{name, detail}]. Old format dishNames:[string] still works.
    let dishes = Array.isArray(body.dishes)
      ? body.dishes
      : Array.isArray(body.dishNames)
      ? body.dishNames.map((name) => ({ name }))
      : [];

    dishes = dishes
      .filter((d) => d && typeof d.name === "string" && d.name.trim())
      .slice(0, 25)
      .map((d) => ({
        name: d.name.trim().slice(0, 120),
        detail: String(d.detail || "").trim().slice(0, 400),
      }));

    if (!dishes.length) {
      return res.status(400).json({ error: "dishes is required" });
    }

    const { occasion, tone } = readMood(body);

    const dishList = dishes
      .map((d, i) => `${i + 1}. ${d.name}${d.detail ? `\n   Chef's note: ${d.detail}` : ""}`)
      .join("\n");

    const prompt = `You write dish descriptions for a printed Indian catering menu.
Occasion: ${occasion}
Tone and style: ${tone}

For each dish below write:
1. "desc": ONE line, maximum 15 words, written in the tone above. When a chef's note is given, it describes how this caterer actually makes or serves the dish (ingredients, style, region, presentation). Base the line on it and never contradict it. Do not just list ingredients. Plain characters only: no emojis, no quotation marks.
2. Approximate nutrition for one standard catering serving as whole numbers: "cal" (kcal), "protein", "carbs", "fat" (grams). Use the chef's note if it changes the recipe.

Return JSON only, one item per dish in the same order, keeping each name exactly as given:
{"items":[{"i":1,"name":"dish name","desc":"...","cal":0,"protein":0,"carbs":0,"fat":0}]}

Dishes:
${dishList}`;

    const out = await callOpenAI(prompt, 3000);
    const items = Array.isArray(out) ? out : Array.isArray(out.items) ? out.items : [];

    // Always return a plain array (same shape the app has always expected).
    return res.status(200).json(
      items.map((it, idx) => ({
        i: Number(it.i) || idx + 1,
        name: String(it.name || dishes[idx]?.name || ""),
        desc: String(it.desc || ""),
        cal: it.cal ?? null,
        protein: it.protein ?? null,
        carbs: it.carbs ?? null,
        fat: it.fat ?? null,
      }))
    );
  } catch (error) {
    console.error("Server error:", error);
    return res.status(error.status || 500).json({ error: "Something went wrong" });
  }
}