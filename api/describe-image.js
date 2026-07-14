const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS = ["qwen/qwen2.5-vl-32b-instruct:free", "openrouter/free"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { imageBase64 } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "imageBase64 is required." });
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(503).json({ error: "Image description is not configured." });
  }

  const prompt = "Describe this lecture slide image in detail for a student who cannot see it. If it is a diagram, chart, scan, histology image, table, circuit, graph, or figure, describe its structure, labeled parts, axes, trends, spatial relationships, or steps precisely enough that someone could reason about it from your description alone. If it is decorative or mostly text-only, say so plainly.";
  let lastError = "OpenRouter request failed.";

  for (let i = 0; i < MODELS.length; i += 1) {
    const model = MODELS[i];
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          }],
        }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        lastError = data.error?.message || `OpenRouter request failed with status ${response.status}.`;
        if ((response.status === 429 || response.status >= 500) && i < MODELS.length - 1) {
          await sleep(700 + Math.random() * 400);
          continue;
        }
        return res.status(response.status || 502).json({ error: lastError, model });
      }

      return res.status(200).json({
        description: data.choices?.[0]?.message?.content || "",
        modelUsed: data.model || model,
      });
    } catch (err) {
      lastError = err.message || "Network error calling OpenRouter.";
      if (i < MODELS.length - 1) {
        await sleep(700 + Math.random() * 400);
        continue;
      }
    }
  }

  return res.status(502).json({ error: lastError });
}
