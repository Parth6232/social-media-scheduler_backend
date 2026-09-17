// FIX: Render ka FREE tier outbound SMTP ports (25, 465, 587) block karta hai
// (Sep 2025 se) — isliye Nodemailer/SMTP kabhi kaam nahi karega chahe koi bhi
// provider ho. Solution: email HTTPS API (port 443) se bhejo, jo kabhi block
// nahi hota. Yahan Brevo ki REST API use ki hai, axios se (axios already
// package.json mein maujood hai, isliye Node version compatibility ki bhi
// chinta nahi — fetch() ki tarah naye Node version pe depend nahi karta).

const axios = require("axios");

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

async function sendViaBrevo({ to, subject, html }) {
  try {
    await axios.post(
      BREVO_API_URL,
      {
        sender: {
          name: "SocialBlitz",
          email: process.env.BREVO_FROM_EMAIL, // Brevo mein verify kiya hua sender email
        },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "content-type": "application/json",
          accept: "application/json",
        },
        timeout: 10000, // 10 second — kabhi hang na ho
      }
    );
  } catch (error) {
    const details = error.response?.data || error.message;
    console.log("❌ BREVO EMAIL ERROR →", details);
    throw new Error("Email send failed");
  }
}

async function sendOtpEmail(to, otp) {
  await sendViaBrevo({
    to,
    subject: "SocialBlitz — Password Reset OTP",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #7C3AED;">SocialBlitz</h2>
        <p>Aapne password reset karne ki request ki hai. Neeche diya gaya OTP use karein:</p>
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; background: #f4f4f5; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 20px 0;">
          ${otp}
        </div>
        <p>Yeh OTP <strong>10 minute</strong> ke liye valid hai.</p>
        <p style="color: #6b7280; font-size: 13px;">Agar aapne yeh request nahi ki, to is email ko ignore kar dein.</p>
      </div>
    `,
  });
}

// NAYA: jab koi anjaan/naya device se login try kare, tab OTP + warning email
async function sendNewDeviceOtpEmail(to, otp, userAgent = "") {
  await sendViaBrevo({
    to,
    subject: "⚠️ SocialBlitz — Naye Device Se Login Attempt",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #7C3AED;">SocialBlitz</h2>
        <p>Aapke account me ek <strong>naye/anjaan device</strong> se login karne ki koshish hui hai.</p>
        ${userAgent ? `<p style="color:#6b7280; font-size:13px;">Device info: ${userAgent}</p>` : ""}
        <p>Agar ye aap the, to neeche diya gaya OTP daal kar login complete karein:</p>
        <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; background: #f4f4f5; padding: 16px 24px; border-radius: 8px; text-align: center; margin: 20px 0;">
          ${otp}
        </div>
        <p>Yeh OTP <strong>10 minute</strong> ke liye valid hai.</p>
        <p style="color: #b91c1c; font-weight: 600; font-size: 13px;">Agar ye login attempt aapne nahi kiya, to turant apna password badal dein aur ye OTP kisi ke saath share na karein.</p>
      </div>
    `,
  });
}

// NAYA: OTP verify hone ke baad, confirm karo ki naya device add ho gaya
async function sendNewDeviceAddedEmail(to, userAgent = "") {
  await sendViaBrevo({
    to,
    subject: "SocialBlitz — Naya Device Aapke Account Se Jud Gaya",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #7C3AED;">SocialBlitz</h2>
        <p>Ek naya device successfully aapke account se verify ho kar jud gaya hai.</p>
        ${userAgent ? `<p style="color:#6b7280; font-size:13px;">Device info: ${userAgent}</p>` : ""}
        <p style="color: #6b7280; font-size: 13px;">Agar ye aap nahi the, turant apna password badal dein.</p>
      </div>
    `,
  });
}

module.exports = { sendOtpEmail, sendNewDeviceOtpEmail, sendNewDeviceAddedEmail };