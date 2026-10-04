// Post-deploy check for the send-sms-sentdm auth hook. Sends NO SMS.
// Usage: node scripts/check-sms-hook.mjs
// Expects: unsigned POST -> 401, POST with a forged signature -> 401.
const URL_ = process.env.HOOK_URL ||
  "https://allwunqurqgdaxjnovhh.supabase.co/functions/v1/send-sms-sentdm";
// Deliberately has no phone/otp so even an unprotected deployment cannot send an SMS.
const body = JSON.stringify({});

async function post(label, headers) {
  const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
  const ok = res.status === 401;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: HTTP ${res.status} (expected 401)`);
  return ok;
}

const results = [
  await post("unsigned request", {}),
  await post("forged signature", {
    "webhook-id": "msg_forged",
    "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    "webhook-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  }),
];
process.exit(results.every(Boolean) ? 0 : 1);
