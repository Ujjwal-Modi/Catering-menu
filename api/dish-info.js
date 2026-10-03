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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};

    if (body.type === "welcome") {
      return await writeWelcome(body, res);
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
