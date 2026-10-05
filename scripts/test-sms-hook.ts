// Offline test for supabase/functions/send-sms-sentdm. Runs the real function
// code in-process with a mocked Sent.dm API and locally signed Standard
// Webhooks requests. Sends NO SMS and touches no Supabase project.
//
// Usage:  deno run -A scripts/test-sms-hook.ts [path/to/index.ts]
// Exit:   0 if every check passes, 1 otherwise
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
const target = Deno.args[0]
  ? new URL(Deno.args[0], "file://" + Deno.cwd() + "/").href
  : new URL("../supabase/functions/send-sms-sentdm/index.ts", import.meta.url).href;
const SECRET_B64 = btoa("0123456789abcdef0123456789abcdef");
Deno.env.set("SEND_SMS_HOOK_SECRET", "v1,whsec_" + SECRET_B64);
Deno.env.set("SENT_API_KEY", "key_TESTKEY");
Deno.env.set("SENT_TEMPLATE_ID", "tpl_TEST");

let handler: (r: Request) => Promise<Response> | Response;
(Deno as any).serve = (h: any) => { handler = h; return { finished: Promise.resolve() }; };

type Mock = (url: string, init: RequestInit) => Promise<Response>;
let mock: Mock = async () => new Response("{}", { status: 202 });
let sentCalls: any[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = ((url: any, init: any) => {
  if (String(url).startsWith("https://api.sent.dm")) { sentCalls.push({ url: String(url), init }); return mock(String(url), init); }
  return realFetch(url, init);
}) as any;

const logs: string[] = [];
for (const k of ["log", "error", "warn"] as const) { (console as any)[k] = (...a: any[]) => logs.push(a.map(x => typeof x === "string" ? x : JSON.stringify(x, Object.getOwnPropertyNames(Object(x)))).join(" ")); }

await import(target);

const wh = new Webhook(SECRET_B64);
function signed(payload: unknown, ts = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(payload); const id = "msg_" + crypto.randomUUID();
  const sig = wh.sign(id, new Date(ts * 1000), body);
  return new Request("https://x/f", { method: "POST", body, headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": sig } });
}
const good = { user: { phone: "15555550123" }, sms: { otp: "123456", phone: "15555550123" } };

let pass = 0, fail = 0; const out: string[] = [];
async function t(name: string, fn: () => Promise<[boolean, string]>) {
  sentCalls = []; logs.length = 0; mock = async () => new Response("{}", { status: 202 });
  const [ok, info] = await fn(); (ok ? pass++ : fail++); out.push(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  <-- " + info}`);
}
const read = async (r: Response) => ({ status: r.status, text: await r.text(), headers: r.headers });

await t("GET -> real 405 + Allow", async () => { const r = await read(await handler(new Request("https://x/f"))); return [r.status === 405 && r.headers.get("allow") === "POST", `${r.status} ${r.headers.get("allow")}`]; });
await t("unsigned POST -> 401 Invalid signature", async () => { const r = await read(await handler(new Request("https://x/f", { method: "POST", body: "{}" }))); return [r.status === 401 && r.text.includes("Invalid signature") && sentCalls.length === 0, `${r.status} ${r.text}`]; });
await t("forged signature -> 401, no Sent call", async () => { const q = new Request("https://x/f", { method: "POST", body: JSON.stringify(good), headers: { "webhook-id": "msg_1", "webhook-timestamp": String(Math.floor(Date.now()/1000)), "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } }); const r = await read(await handler(q)); return [r.status === 401 && sentCalls.length === 0, `${r.status}`]; });
await t("stale timestamp (replay) -> 401", async () => { const r = await read(await handler(signed(good, Math.floor(Date.now()/1000) - 3600))); return [r.status === 401 && sentCalls.length === 0, `${r.status}`]; });
await t("oversized content-length -> 413 before reading", async () => { const r = await read(await handler(new Request("https://x/f", { method: "POST", body: "x".repeat(20000), headers: { "content-length": "20000" } }))); return [r.status === 413 && sentCalls.length === 0, `${r.status}`]; });
await t("valid + Sent 202 -> 200 {} and correct provider payload", async () => {
  const r = await read(await handler(signed(good))); const c = sentCalls[0]; const b = c && JSON.parse(c.init.body);
  return [r.status === 200 && r.text === "{}" && sentCalls.length === 1 && c.init.headers["x-api-key"] === "key_TESTKEY" && b.to[0] === "15555550123" && b.template.id === "tpl_TEST" && b.template.parameters.code === "123456" && b.channel[0] === "sms", `${r.status} ${r.text} ${JSON.stringify(b)}`]; });
await t("OTP and full phone never logged", async () => { await handler(signed(good)); const all = logs.join("\n"); return [!all.includes("123456") && !all.includes("15555550123"), all]; });
await t("Sent 400 w/ sensitive body -> generic 400, no leak, detail logged", async () => {
  mock = async () => new Response(JSON.stringify({ error: { message: "template tpl_SECRET123 invalid for account acct_9999" } }), { status: 400 });
  const r = await read(await handler(signed(good))); const j = JSON.parse(r.text);
  return [r.status === 200 && j.error.http_code === 400 && !/tpl_SECRET123|acct_9999/.test(r.text) && logs.join("").includes("tpl_SECRET123"), r.text]; });
await t("Sent 500 -> generic 500, no leak", async () => { mock = async () => new Response("upstream stack trace /srv/app.js:42 key_LEAK", { status: 500 }); const r = await read(await handler(signed(good))); return [JSON.parse(r.text).error.http_code === 500 && !/stack|key_LEAK/.test(r.text), r.text]; });
await t("Sent 502 non-JSON (HTML) body -> handled generically", async () => { mock = async () => new Response("<html>Bad gateway</html>", { status: 502 }); const r = await read(await handler(signed(good))); return [r.status === 200 && JSON.parse(r.text).error.http_code === 500 && !r.text.includes("html"), r.text]; });
await t("fetch throws internal error -> generic, no leak", async () => { mock = async () => { throw new Error("boom internal secret db=10.0.0.5"); }; const r = await read(await handler(signed(good))); return [JSON.parse(r.text).error.http_code === 500 && !/boom|10\.0\.0\.5/.test(r.text) && logs.join("").includes("boom"), r.text]; });
await t("Sent hangs -> times out (~4s), generic timeout message", async () => {
  mock = (_u, init) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)));
  const t0 = Date.now(); const r = await read(await handler(signed(good))); const ms = Date.now() - t0;
  return [ms >= 3500 && ms < 6000 && r.status === 200 && /timed out/.test(r.text), `${ms}ms ${r.text}`]; });
await t("signed but missing otp -> 400 generic", async () => { const r = await read(await handler(signed({ user: { phone: "1555" }, sms: {} }))); return [JSON.parse(r.text).error.http_code === 400 && sentCalls.length === 0, r.text]; });
Deno.env.delete("SENT_API_KEY");
await t("missing SENT_API_KEY -> 'not configured', no Sent call", async () => { const r = await read(await handler(signed(good))); return [/not configured/.test(r.text) && sentCalls.length === 0, r.text]; });
Deno.env.set("SENT_API_KEY", "key_TESTKEY");
Deno.env.delete("SEND_SMS_HOOK_SECRET");
await t("missing hook secret -> real 500 (fail closed)", async () => { const r = await read(await handler(signed(good))); return [r.status === 500 && sentCalls.length === 0, `${r.status}`]; });

console.log = (...a: any[]) => Deno.stdout.writeSync(new TextEncoder().encode(a.join(" ") + "\n"));
console.log(out.join("\n")); console.log(`\n${pass} passed, ${fail} failed`);
Deno.exit(fail ? 1 : 0);
