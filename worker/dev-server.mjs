// Run the Worker locally for testing: node worker/dev-server.mjs  (reads GEMINI_API_KEY from .env)
// Then open the page at http://localhost:8000/?relay=http://127.0.0.1:8787
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import worker from "./worker.js";

const envFile = new URL("../.env", import.meta.url);
const env = Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://127.0.0.1:8787${req.url}`, {
    method: req.method, headers: req.headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, "127.0.0.1", () => console.log("relay on http://127.0.0.1:8787"));
