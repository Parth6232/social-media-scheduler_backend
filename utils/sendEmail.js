const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function sendOtpEmail(to, otp) {
    const mailOptions = {
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
    };
    await transporter.sendMail(mailOptions);
}

module.exports = { sendOtpEmail };