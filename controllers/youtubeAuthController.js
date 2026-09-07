const { google } = require("googleapis");
const ConnectedAccount = require("../models/ConnectedAccount");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Same glossy styled HTML result page jo Facebook callback mein use hoti hai, OK button ke saath
function renderResultPage(title, message, isSuccess = true) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>${title}</title>
        <style>
          body { font-family: 'Inter', sans-serif; background: #0A0F1E; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 40px; text-align: center; max-width: 420px; backdrop-filter: blur(10px); }
          .icon { font-size: 48px; margin-bottom: 16px; }
          h1 { font-size: 20px; margin-bottom: 8px; }
          p { color: #9CA3AF; margin-bottom: 24px; }
          button { background: linear-gradient(135deg, #7C3AED, #2563EB); color: white; border: none; padding: 12px 32px; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; }
          button:hover { opacity: 0.9; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">${isSuccess ? "✅" : "⚠️"}</div>
          <h1>${title}</h1>
          <p>${message}</p>
          <button onclick="window.location.href='${FRONTEND_URL}/accounts'">OK</button>
        </div>
      </body>
    </html>
  `;
}

// STEP A: User ko Google ke login page pe bhejna
exports.redirectToGoogle = (req, res) => {
  const { userId } = req.query;

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
    state: userId,
  });

  res.redirect(url);
};

// STEP B: Google se wapas aane ke baad
exports.googleCallback = async (req, res) => {
  try {
    const { code, state } = req.query;

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const channelRes = await youtube.channels.list({
      part: "snippet",
      mine: true,
    });
    if (!channelRes.data.items || channelRes.data.items.length === 0) {
      return res
        .status(400)
        .send(
          renderResultPage(
            "Channel Not Found",
            "Is account ka koi YouTube channel nahi mila. Pehle ek channel banao, phir dobara try karo.",
            false
          )
        );
    }
    const channel = channelRes.data.items[0];

    await ConnectedAccount.findOneAndUpdate(
      { userId: state, platform: "youtube" },
      {
        userId: state,
        platform: "youtube",
        platformAccountId: channel.id,
        displayName: channel.snippet.title,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(tokens.expiry_date),
      },
      { upsert: true, new: true }
    );

    res.send(renderResultPage("Success!", "YouTube account connect ho gaya.", true));
  } catch (error) {
    console.error(error);
    res.status(500).send(renderResultPage("Connection Failed", error.message, false));
  }
};