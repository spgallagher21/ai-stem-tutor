// Vercel serverless function. Users bring their own Gemini API key.
// The key is forwarded only for this request and is not stored by the app.

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRetryAfterSeconds(data) {
  const retryInfo = (data?.error?.details || []).find((detail) => detail?.["@type"]?.includes("RetryInfo"));
  const retryDelay = retryInfo?.retryDelay;
  if (typeof retryDelay === "string") return Math.ceil(Number(retryDelay.replace("s", "")));
  const messageMatch = String(data?.error?.message || "").match(/retry\s+in\s+([\d.]+)/i);
  return messageMatch ? Math.ceil(Number(messageMatch[1])) : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { contents, generationConfig, apiKey: requestApiKey, documentPart, tools } = req.body || {};
  const apiKey = typeof requestApiKey === "string" && requestApiKey.trim()
    ? requestApiKey.trim()
    : process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({
      error: "Enter your Gemini API key before using the tutor.",
    });
  }

  if (!contents) {
    return res.status(400).json({ error: "Missing 'contents' in request body." });
  }

  const payloadContents = documentPart && Array.isArray(contents) && contents[0]?.parts
    ? [
        {
          ...contents[0],
          parts: [...contents[0].parts, documentPart],
        },
        ...contents.slice(1),
      ]
    : contents;

  const payload = {
    contents: payloadContents,
    generationConfig: generationConfig || {},
  };

  if (tools) payload.tools = tools;

  const maxAttempts = 3;
  let lastErrMessage = "Gemini request failed.";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const responseText = await r.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (err) {
        const details = responseText ? ` Response started with: ${responseText.slice(0, 120)}` : "";
        throw new Error(`Gemini returned a non-JSON response.${details}`);
      }

      if (!r.ok) {
        lastErrMessage = data?.error?.message || `Gemini error (status ${r.status})`;
        const retryAfterSeconds = extractRetryAfterSeconds(data);
        const retryable = r.status >= 500;
        if (r.status === 429) {
          return res.status(r.status).json({ error: lastErrMessage, retryAfterSeconds });
        }
        if (retryable && attempt < maxAttempts) {
          await sleep(attempt * 700);
          continue;
        }
        return res.status(r.status).json({ error: lastErrMessage });
      }

      return res.status(200).json(data);
    } catch (err) {
      lastErrMessage = err.message || "Network error calling Gemini.";
      if (attempt < maxAttempts) {
        await sleep(attempt * 700);
        continue;
      }
    }
  }

  return res.status(502).json({ error: lastErrMessage });
}
