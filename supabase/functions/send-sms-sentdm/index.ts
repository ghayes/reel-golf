import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const SENT_API_URL = "https://api.sent.dm/v3/messages";
// Supabase Auth gives hooks ~5s; fail on our own first so we can log why.
const SENT_TIMEOUT_MS = 4000;
// Supabase documents a 20KB cap on hook payloads; refuse anything larger
// (checked on the declared length first, then on the actual bytes) since the
// signature is only verified after the body is buffered.
const MAX_BODY_BYTES = 20_480;

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

// Provider error bodies can echo the recipient number or the code. Strip both
// (and any long digit run) before they reach the logs.
function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/\+?\d{7,}/g, "[number]");
}

// Errors for a request that already passed signature verification. Supabase
// Auth's hook protocol expects HTTP 200 with an {error:{http_code,message}}
// body for these (a non-2xx makes it report a generic hook failure, and may
// retry, which could send duplicate SMS). Messages shown to end users stay
// generic; details go to the function logs.
function hookError(httpCode: number, message: string) {
  return json(200, { error: { http_code: httpCode, message } });
}

Deno.serve(async (req: Request) => {
  // Only Supabase Auth (POST) legitimately calls this. Anything else is not a
  // hook call, so use real HTTP status codes that monitoring can see.
  if (req.method !== "POST") {
    return json(405, { error: { http_code: 405, message: "Method not allowed" } }, { Allow: "POST" });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return json(413, { error: { http_code: 413, message: "Payload too large" } });
  }

  // Fail closed: this endpoint is publicly reachable, so every request must
  // carry a valid Standard Webhooks signature from Supabase Auth. Without this
  // anyone could trigger SMS to arbitrary numbers through our Sent.dm account.
  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET")?.trim().replace("v1,whsec_", "");
  if (!hookSecret) {
    console.error("SEND_SMS_HOOK_SECRET is not configured");
    return json(500, { error: { http_code: 500, message: "SMS hook is not configured" } });
  }

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return json(413, { error: { http_code: 413, message: "Payload too large" } });
  }
  let body: any;
  try {
    body = new Webhook(hookSecret).verify(rawBody, Object.fromEntries(req.headers));
  } catch (_err) {
    console.warn("Rejected send-sms hook request: invalid signature");
    return json(401, { error: { http_code: 401, message: "Invalid signature" } });
  }

  try {
    const phone = body.sms?.phone || body.user?.phone;
    const otp = body.sms?.otp;

    console.log("Send SMS hook payload:", {
      hasUser: !!body.user,
      phone: phone ? `${phone.slice(0, 4)}***` : null,
      hasOtp: !!otp,
    });

    if (!phone || !otp) {
      console.error("Send SMS hook payload missing phone or otp");
      return hookError(400, "Missing phone number or OTP in request");
    }

    const apiKey = Deno.env.get("SENT_API_KEY");
    if (!apiKey) {
      console.error("SENT_API_KEY is not configured");
      return hookError(500, "SMS provider is not configured");
    }

    const templateId = Deno.env.get("SENT_TEMPLATE_ID");
    if (!templateId) {
      console.error("SENT_TEMPLATE_ID is not configured");
      return hookError(500, "SMS provider is not configured");
    }

    const sentPayload = {
      to: [phone],
      template: {
        id: templateId,
        parameters: {
          code: String(otp),
        },
      },
      channel: ["sms"],
    };

    const sentResponse = await fetch(SENT_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(sentPayload),
      signal: AbortSignal.timeout(SENT_TIMEOUT_MS),
    });

    if (!sentResponse.ok) {
      // The provider's body may contain account/template details and the
      // recipient number: log a redacted, bounded excerpt, never return it.
      const detail = redact(await sentResponse.text().catch(() => ""), [phone, String(otp)]).slice(0, 300);
      console.error("Sent.dm error:", sentResponse.status, detail);
      return sentResponse.status === 400
        ? hookError(400, "Could not send a code to that phone number")
        : hookError(500, "Failed to send verification code");
    }

    // The SMS has been accepted: nothing after this point may turn it into an
    // error (the user would retry and get a second code).
    await sentResponse.body?.cancel().catch(() => {});

    // GoTrue expects HTTP 200 with empty JSON or {}
    return json(200, {});
  } catch (err: unknown) {
    const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
    console.error(
      timedOut ? "Sent.dm request timed out" : "Unhandled error in send-sms-sentdm:",
      err,
    );
    return hookError(500, timedOut ? "SMS provider timed out, please try again" : "Failed to send verification code");
  }
});
