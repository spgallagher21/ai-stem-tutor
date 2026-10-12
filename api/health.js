import { authenticationMode, firebaseProjectId } from "./_security.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const authMode = authenticationMode();
  const firebaseConfigured = Boolean(firebaseProjectId());
  return res.status(authMode === "misconfigured" ? 503 : 200).json({
    status: authMode === "misconfigured" ? "degraded" : "ok",
    authentication: authMode,
    firebaseConfigured,
    geminiServerKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    visionConfigured: Boolean(process.env.OPENROUTER_API_KEY),
  });
}
