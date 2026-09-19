// Thin wrapper around Meta's WhatsApp Cloud API (graph.facebook.com).
// Needs a WhatsApp Business account + phone number set up in Meta Business
// Manager first — see https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
//
// Until WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are set in .env,
// this quietly no-ops (logs to console in dev) instead of throwing, so it's
// safe to call from notify() unconditionally.

async function sendWhatsAppMessage(toPhone, message) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!toPhone) return; // user never gave us a phone number — nothing to send to

  if (!token || !phoneNumberId) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[whatsapp:not-configured] Would message ${toPhone}: ${message}`);
    }
    return;
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toPhone.replace(/[^\d+]/g, ""), // Meta expects E.164, e.g. +9198XXXXXXXX
        type: "text",
        text: { body: message },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`WhatsApp send failed (${res.status}): ${body.slice(0, 300)}`);
    }
  } catch (err) {
    console.error("WhatsApp send error:", err.message);
  }
}

module.exports = { sendWhatsAppMessage };
