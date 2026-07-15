const FILES_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "25mb",
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!await secureRequest(req, res, { limit: 8, maxBodyBytes: 25 * 1024 * 1024 })) return;

  const { apiKey: requestApiKey, displayName, mimeType = "application/pdf", data } = req.body || {};
  const apiKey = typeof requestApiKey === "string" && requestApiKey.trim()
    ? requestApiKey.trim()
    : process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(400).json({ error: "Enter your Gemini API key before uploading files." });
  if (!data) return res.status(400).json({ error: "Missing file data." });
  if (mimeType !== "application/pdf") return res.status(400).json({ error: "Only PDF uploads are supported." });
  try { validateBase64(data, 18 * 1024 * 1024); } catch (error) { return res.status(400).json({ error: error.message }); }

  try {
    const bytes = Buffer.from(data, "base64");
    const start = await fetchWithTimeout(`${FILES_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName || "source.pdf" } }),
    }, 45_000);

    if (!start.ok) {
      const details = await start.text();
      return res.status(start.status).json({ error: details || "Could not start Gemini file upload." });
    }

    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) return res.status(502).json({ error: "Gemini did not return an upload URL." });
    if (!/^https:\/\/[^/]*googleapis\.com\//i.test(uploadUrl)) return res.status(502).json({ error: "Gemini returned an invalid upload destination." });

    const finish = await fetchWithTimeout(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(bytes.length),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: bytes,
    }, 60_000);

    const payload = await finish.json();
    if (!finish.ok) {
      return res.status(finish.status).json({ error: payload?.error?.message || "Gemini file upload failed." });
    }

    const expiresAt = Date.now() + 47 * 60 * 60 * 1000;
    return res.status(200).json({ fileUri: payload.file?.uri, expiresAt });
  } catch (err) {
    return res.status(502).json({ error: err.message || "Gemini file upload failed." });
  }
}
import { fetchWithTimeout, secureRequest, validateBase64 } from "./_security.js";
