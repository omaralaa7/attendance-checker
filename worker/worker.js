// Cloudflare Worker: relays the attendance page's request to Gemini, keeping the API key secret.
// Settings → Variables and Secrets:
//   GEMINI_API_KEY   (Secret)  your Google AI Studio key
//   ALLOWED_ORIGINS  (Text)    comma-separated site addresses, e.g. https://yourname.github.io
//   GEMINI_MODEL     (Text, optional)  defaults to gemini-3.8-flash

const DEFAULT_MODEL = "gemini-3.8-flash";
const MAX_IMAGES = 6;
const MAX_BODY = 20 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const ok = isLocal || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": ok ? origin : "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const reply = (status, obj) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: ok ? 204 : 403, headers: cors });
    if (!ok) return reply(403, { error: "forbidden_origin" });
    if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
    if (!env.GEMINI_API_KEY) return reply(500, { error: "missing_key" });
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) return reply(413, { error: "too_large" });

    let body;
    try { body = await request.json(); } catch { return reply(400, { error: "bad_json" }); }
    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length || images.length > MAX_IMAGES || typeof body.prompt !== "string")
      return reply(400, { error: "bad_request" });

    const parts = images.map(img => ({ inline_data: { mime_type: "image/jpeg", data: String(img) } }));
    parts.push({ text: body.prompt });

    const model = env.GEMINI_MODEL || DEFAULT_MODEL;
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
      });
    } catch {
      return reply(502, { error: "upstream_unreachable" });
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = r.status === 429 ? "quota" : (r.status === 400 || r.status === 403) ? "key_or_request" : "upstream";
      return reply(r.status === 429 ? 429 : 502, { error: code, detail: j?.error?.message || "" });
    }
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    if (!text) return reply(502, { error: "empty", detail: cand?.finishReason || "" });
    return reply(200, { text });
  },
};
