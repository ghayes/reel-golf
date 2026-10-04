import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const SENT_API_URL = "https://api.sent.dm/v3/messages";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: { http_code: 405, message: "Method not allowed" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fail closed: this endpoint is publicly reachable, so every request must
  // carry a valid Standard Webhooks signature from Supabase Auth. Without this
  // anyone could trigger SMS to arbitrary numbers through our Sent.dm account.
  const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET")?.replace("v1,whsec_", "");
  if (!hookSecret) {
    console.error("SEND_SMS_HOOK_SECRET is not configured");
    return new Response(
      JSON.stringify({ error: { http_code: 500, message: "SMS hook is not configured" } }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const rawBody = await req.text();
  let body: any;
  try {
    body = new Webhook(hookSecret).verify(rawBody, Object.fromEntries(req.headers));
  } catch (_err) {
    console.warn("Rejected send-sms hook request: invalid signature");
    return new Response(
      JSON.stringify({ error: { http_code: 401, message: "Invalid signature" } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
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
      return new Response(
        JSON.stringify({
          error: {
            http_code: 400,
            message: "Missing phone number or OTP in request",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("SENT_API_KEY");
    if (!apiKey) {
      console.error("SENT_API_KEY is not configured");
      return new Response(
        JSON.stringify({
          error: {
            http_code: 500,
            message: "SMS provider is not configured",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const templateId = Deno.env.get("SENT_TEMPLATE_ID");
    if (!templateId) {
      console.error("SENT_TEMPLATE_ID is not configured");
      return new Response(
        JSON.stringify({
          error: {
            http_code: 500,
            message: "SMS provider is not configured",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
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
    });

    const sentResult = await sentResponse.json();

    if (!sentResponse.ok && sentResponse.status !== 202) {
      console.error("Sent.dm error:", sentResponse.status, sentResult);
      const errMsg = sentResult.error?.message || "Failed to dispatch SMS through Sent.dm";
      return new Response(
        JSON.stringify({
          error: {
            http_code: sentResponse.status === 400 ? 400 : 500,
            message: errMsg,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // GoTrue expects HTTP 200 with empty JSON or {}
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Unhandled error in send-sms-sentdm:", err);
    return new Response(
      JSON.stringify({
        error: {
          http_code: 500,
          message: err.message || "Internal server error in SMS hook",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
});
