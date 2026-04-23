// =========================
// emailService.js (RESEND)
// =========================

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendNotification({ subject, text }) {
  try {
    await resend.emails.send({
      from: "Lead Sync <onboarding@resend.dev>", // works immediately
      to: process.env.ALERT_EMAIL,
      subject,
      text
    });

    console.log("📧 Notification sent:", subject);
  } catch (err) {
    console.error("❌ Email send failed:", err);
  }
}
