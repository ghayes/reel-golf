// Post-deploy check for the send-sms-sentdm auth hook. Sends NO SMS.
//
// Usage:  node scripts/check-sms-hook.mjs
// Env:    HOOK_URL  override the function URL (default: production project)
// Exit:   0 if every check passes, 1 otherwise
//
// Expects the function itself (not the Supabase gateway) to reject unsigned and
// forged requests with 401 {"error":{"message":"Invalid signature"}}. Checking
// the body matters: if verify_jwt were ever on, the gateway would also return
// 401, which would hide that Auth's hook calls (which carry no JWT) are broken.
const HOOK_URL = process.env.HOOK_URL ||
  "https://allwunqurqgdaxjnovhh.supabase.co/functions/v1/send-sms-sentdm";
// Deliberately has no phone/otp so even an unprotected deployment cannot send an SMS.
const body = JSON.stringify({});

async function check(label, headers) {
  let status = null, text = "", ok = false;
  try {
    const res = await fetch(HOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    text = await res.text();
    let message;
    try { message = JSON.parse(text)?.error?.message; } catch { /* non-JSON body */ }
    ok = status === 401 && message === "Invalid signature";
  } catch (err) {
    text = `request failed: ${err.name}: ${err.message}`;
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: HTTP ${status ?? "n/a"} ${text.slice(0, 200)}`);
  return ok;
}

const results = [
  await check("unsigned request", {}),
  await check("forged signature", {
    "webhook-id": "msg_forged",
    "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  }),
];
process.exit(results.every(Boolean) ? 0 : 1);
