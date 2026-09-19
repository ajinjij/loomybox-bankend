const prisma = require("./prisma");
const { sendWhatsAppMessage } = require("./whatsapp");

/**
 * Creates an in-app notification for a user, and also relays it to WhatsApp
 * if the user has a phone number on file (and WhatsApp is configured — see
 * lib/whatsapp.js). Fire-and-forget from any route — failures are logged but
 * never thrown, so a notification bug can never break the actual action
 * (booking, quote, etc.) that triggered it.
 *
 * To add real email/SMS later: this is the single choke point to hook another
 * provider (SendGrid, Twilio SMS) into as well, using user.email / user.phone.
 */
async function notify(userId, type, message, link = null) {
  try {
    await prisma.notification.create({ data: { userId, type, message, link } });
  } catch (err) {
    console.error("Failed to create notification:", err.message);
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (user && user.phone) {
      await sendWhatsAppMessage(user.phone, message);
    }
  } catch (err) {
    console.error("Failed to relay notification to WhatsApp:", err.message);
  }
}

module.exports = { notify };

