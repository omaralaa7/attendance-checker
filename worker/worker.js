// Cloudflare Worker: relays the attendance page's request to Gemini, keeping the API key secret.
// Settings → Variables and Secrets:
//   GEMINI_API_KEY   (Secret)  your Google AI Studio key
//   ALLOWED_ORIGINS  (Text)    comma-separated site addresses, e.g. https://yourname.github.io
//   GEMINI_MODELS    (Text, optional)  comma-separated models to try in order; defaults to MODELS below

// Tried in order. Free-tier models are often overloaded (503), so we fall through to the next one.
// All of these scored 98-100% on the sample sheets; the "lite" models scored ~94% and are left out.
const MODELS = ["gemini-3.8-flash", "gemini-3-flash-preview", "gemini-3.6-flash", "gemini-3.7-flash"];
const ROUNDS = 3, ROUND_PAUSE_MS = 8000;
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

    const models = (env.GEMINI_MODELS || "").split(",").map(m => m.trim()).filter(Boolean);
    const chain = models.length ? models : MODELS;
    const payload = JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });
    let r = null, j = {}, used = "";
    outer: for (let round = 0; round < ROUNDS; round++) {
      if (round) await new Promise(res => setTimeout(res, ROUND_PAUSE_MS));
      for (const model of chain) {
        let resp;
        try {
          resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
            body: payload,
          });
        } catch {
          continue;
        }
        r = resp; used = model;
        j = await resp.json().catch(() => ({}));
        // 404: model retired; 5xx/429: busy or per-model quota -> try the next model
        if (resp.ok || !(resp.status >= 500 || resp.status === 429 || resp.status === 404)) break outer;
      }
    }
    if (!r) return reply(502, { error: "upstream_unreachable" });
    if (!r.ok) {
      const code = r.status === 429 ? "quota" : r.status >= 500 ? "busy" : (r.status === 400 || r.status === 403) ? "key_or_request" : "upstream";
      return reply(r.status === 429 ? 429 : 502, { error: code, detail: j?.error?.message || "" });
    }
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    if (!text) return reply(502, { error: "empty", detail: cand?.finishReason || "" });
    return reply(200, { text, model: used });
  },
};
