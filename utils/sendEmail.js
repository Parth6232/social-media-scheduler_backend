const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER, // aapka Gmail address, e.g. yourapp@gmail.com
    pass: process.env.EMAIL_PASS, // Google se generate kiya hua 16-character App Password
  },
  // FIX: Render ke network mein IPv6 route nahi hai — is wajah se Gmail SMTP se
  // connect karte waqt "ENETUNREACH" aata tha. family: 4 se sirf IPv4 use hoga.
  // (server.js mein dns.setDefaultResultOrder("ipv4first") bhi isi wajah se hai —
  // dono milke ye issue permanently khatam karte hain, ye kisi Render setting pe
  // depend nahi karta isliye future mein wapas nahi aayega)
  family: 4,

  // SAFETY: agar Gmail server slow respond kare ya na respond kare, request
  // hamesha ke liye latki na rahe — 10 second ke andar fail/retry ho jaaye
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
});

// SAFETY: agar koi temporary network blip aaye (jaise ENETUNREACH, ETIMEDOUT,
// ECONNRESET), toh turant fail hone ke bajaye khud-ba-khud 2 baar aur try kare
// thodi si delay ke saath, isse ek chhoti si glitch pura flow nahi todegi
async function sendWithRetry(mailOptions, retries = 2, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      return;
    } catch (error) {
      const isLastAttempt = attempt === retries + 1;
      console.log(`❌ EMAIL SEND FAILED (attempt ${attempt}/${retries + 1}) →`, error.message);

      if (isLastAttempt) {
        throw error; // saari retries khatam ho gayi, ab error upar bhejo
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function sendOtpEmail(to, otp) {
  await sendWithRetry({
    from: `"SocialBlitz" <${process.env.EMAIL_USER}>`,
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
  await sendWithRetry({
    from: `"SocialBlitz" <${process.env.EMAIL_USER}>`,
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
  await sendWithRetry({
    from: `"SocialBlitz" <${process.env.EMAIL_USER}>`,
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