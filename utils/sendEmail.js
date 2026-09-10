const sgMail = require("@sendgrid/mail");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
// NOTE: Ye wahi email honi chahiye jo SendGrid mein "Single Sender
// Verification" ke through verify ki hai (Settings > Sender Authentication).
const FROM_ADDRESS = process.env.SENDGRID_FROM_EMAIL;

async function sendOtpEmail(to, otp) {
  await sgMail.send({
    from: FROM_ADDRESS,
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
  await sgMail.send({
    from: FROM_ADDRESS,
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
  await sgMail.send({
    from: FROM_ADDRESS,
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