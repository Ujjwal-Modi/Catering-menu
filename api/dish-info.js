export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { dishNames } = req.body;

    if (!Array.isArray(dishNames) || dishNames.length === 0) {
      return res.status(400).json({ error: "dishNames is required" });
    }

    const dishList = dishNames
      .map((d, i) => `${i + 1}. ${d}`)
      .join("\n");

    const prompt = `You are a luxury 5-star hotel menu copywriter. For each Indian dish listed below, write:
1. A single elegant, evocative description line (max 15 words) that makes the dish sound magical, rich, and mouth-watering. Use sensory words — aromas, textures, flavors. Think fine-dining menu language. Do NOT just list ingredients.
2. Approximate nutrition per serving: Calories, Protein(g), Carbs(g), Fat(g)

Respond ONLY in valid JSON array format, no markdown, no backticks.

Each item:
{"name":"dish name","desc":"your elegant one-line description","cal":number,"protein":number,"carbs":number,"fat":number}

Dishes:
${dishList}`;

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 3000,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI error:", data);
      return res.status(response.status).json({
        error: "OpenAI request failed",
      });
    }

    let text = data.choices?.[0]?.message?.content || "";

    text = text
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();

    const result = JSON.parse(text);

    return res.status(200).json(result);

  } catch (error) {
    console.error("Server error:", error);

    return res.status(500).json({
      error: "Something went wrong",
    });
  }
}