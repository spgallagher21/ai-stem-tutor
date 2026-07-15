import { fetchWithTimeout, secureRequest } from "./_security.js";

// Vercel serverless function. Users bring their own Gemini API key.
// The key is forwarded only for this request and is not stored by the app.

const DEFAULT_MODELS = ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-flash-latest"];
const MODELS = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || DEFAULT_MODELS.join(","))
  .split(",")
  .map((model) => model.trim())
  .filter(Boolean);

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

function shouldTryNextModel(status, message) {
  return status === 404
    || status === 503
    || /high demand|overloaded|unavailable|no longer available|not found/i.test(String(message || ""));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!await secureRequest(req, res, { limit: 24, maxBodyBytes: 20 * 1024 * 1024 })) return;

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
  if (!Array.isArray(contents) || contents.length > 12 || JSON.stringify(contents).length > 18_000_000) {
    return res.status(400).json({ error: "Invalid or oversized prompt." });
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

  const maxAttempts = 2;
  let lastErrMessage = "Gemini request failed.";
  let lastStatus = 502;

  for (const model of MODELS) {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const r = await fetchWithTimeout(`${geminiUrl}?key=${encodeURIComponent(apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, 60_000);

        const responseText = await r.text();
        let data;
        try {
          data = JSON.parse(responseText);
        } catch (err) {
          const details = responseText ? ` Response started with: ${responseText.slice(0, 120)}` : "";
          throw new Error(`Gemini returned a non-JSON response.${details}`);
        }

        if (!r.ok) {
          lastStatus = r.status;
          lastErrMessage = data?.error?.message || `Gemini error (status ${r.status})`;
          const retryAfterSeconds = extractRetryAfterSeconds(data);
          const tryNextModel = shouldTryNextModel(r.status, lastErrMessage);
          const retryable = r.status >= 500 && !tryNextModel;
          if (r.status === 429) {
            return res.status(r.status).json({ error: lastErrMessage, retryAfterSeconds, model });
          }
          if (tryNextModel) break;
          if (retryable && attempt < maxAttempts) {
            await sleep(attempt * 700);
            continue;
          }
          return res.status(r.status).json({ error: lastErrMessage, model });
        }

        return res.status(200).json({ ...data, modelUsed: model });
      } catch (err) {
        lastErrMessage = err.message || "Network error calling Gemini.";
        lastStatus = 502;
        if (attempt < maxAttempts) {
          await sleep(attempt * 700);
          continue;
        }
      }
    }
  }

  return res.status(lastStatus).json({
    error: `${lastErrMessage} Tried models: ${MODELS.join(", ")}.`,
  });
}
