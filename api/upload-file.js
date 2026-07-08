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

  const { apiKey: requestApiKey, displayName, mimeType = "application/pdf", data } = req.body || {};
  const apiKey = typeof requestApiKey === "string" && requestApiKey.trim()
    ? requestApiKey.trim()
    : process.env.GEMINI_API_KEY;

  if (!apiKey) return res.status(400).json({ error: "Enter your Gemini API key before uploading files." });
  if (!data) return res.status(400).json({ error: "Missing file data." });

  try {
    const bytes = Buffer.from(data, "base64");
    const start = await fetch(`${FILES_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: displayName || "source.pdf" } }),
    });

    if (!start.ok) {
      const details = await start.text();
      return res.status(start.status).json({ error: details || "Could not start Gemini file upload." });
    }

    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) return res.status(502).json({ error: "Gemini did not return an upload URL." });

    const finish = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Length": String(bytes.length),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
      },
      body: bytes,
    });

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
