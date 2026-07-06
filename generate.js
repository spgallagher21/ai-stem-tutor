// api/generate.js
//
// Vercel serverless function. The client never sees the Gemini API key —
// it POSTs { contents, generationConfig } here, and this function attaches
// the key server-side before calling Google.
//
// SETUP (one-time):
// 1. Drop this file at api/generate.js in your repo (Vercel auto-detects it).
// 2. In the Vercel dashboard: Project -> Settings -> Environment Variables,
//    add GEMINI_API_KEY = <your Gemini API key>. Redeploy.
// 3. Never put the key in client code, .env files committed to git, or a
//    NEXT_PUBLIC_ / VITE_ prefixed variable — those all end up in the browser bundle.

const MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Server misconfigured: GEMINI_API_KEY is not set in the Vercel project environment variables.",
    });
  }

  const { contents, generationConfig } = req.body || {};
  if (!contents) {
    return res.status(400).json({ error: "Missing 'contents' in request body." });
  }

  const payload = {
    contents,
    generationConfig: generationConfig || {},
  };

  const maxAttempts = 3;
  let lastErrMessage = "Gemini request failed.";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await r.json();

      if (!r.ok) {
        lastErrMessage = data?.error?.message || `Gemini error (status ${r.status})`;
        const retryable = r.status === 429 || r.status >= 500;
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
