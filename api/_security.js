import { decodeProtectedHeader, importX509, jwtVerify } from "jose";

const buckets = globalThis.__studyLoopRateBuckets || new Map();
globalThis.__studyLoopRateBuckets = buckets;

let firebaseCerts = { expiresAt: 0, values: {} };

async function verifyFirebaseToken(token) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Firebase project is not configured.");
  if (firebaseCerts.expiresAt < Date.now()) {
    const response = await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com");
    if (!response.ok) throw new Error("Could not load Firebase signing certificates.");
    const maxAge = Number(response.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] || 3600);
    firebaseCerts = { values: await response.json(), expiresAt: Date.now() + maxAge * 1000 };
  }
  const { kid } = decodeProtectedHeader(token);
  const certificate = firebaseCerts.values[kid];
  if (!certificate) throw new Error("Unknown Firebase signing certificate.");
  const key = await importX509(certificate, "RS256");
  const { payload } = await jwtVerify(token, key, { audience: projectId, issuer: `https://securetoken.google.com/${projectId}`, algorithms: ["RS256"] });
  if (!payload.sub) throw new Error("Firebase token has no user identifier.");
  return payload;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

export async function secureRequest(req, res, { limit = 30, windowMs = 60_000, maxBodyBytes = 20 * 1024 * 1024 } = {}) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > maxBodyBytes) {
    res.status(413).json({ error: "Request is too large." });
    return null;
  }

  let uid = "local";
  const firebaseConfigured = Boolean(process.env.FIREBASE_PROJECT_ID);
  if (firebaseConfigured) {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) {
      res.status(401).json({ error: "Sign in before using the tutor." });
      return null;
    }
    try {
      uid = (await verifyFirebaseToken(token)).sub;
    } catch {
      res.status(401).json({ error: "Your session expired. Refresh and try again." });
      return null;
    }
  }

  const now = Date.now();
  const key = `${uid}:${clientIp(req)}`;
  const bucket = (buckets.get(key) || []).filter((timestamp) => timestamp > now - windowMs);
  if (bucket.length >= limit) {
    res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
    res.status(429).json({ error: "Too many requests. Wait a minute and try again." });
    return null;
  }
  bucket.push(now);
  buckets.set(key, bucket);
  return { uid };
}

export async function fetchWithTimeout(url, options, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function validateBase64(value, maxBytes) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error("Invalid encoded file data.");
  const approximateBytes = Math.floor(value.length * 0.75);
  if (approximateBytes > maxBytes) throw new Error("Uploaded data exceeds the allowed size.");
}
