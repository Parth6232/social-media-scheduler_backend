const { google } = require("googleapis");
const ConnectedAccount = require("../models/ConnectedAccount");

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

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
  return res.status(400).send(
    "There is no youtube channel of this account. Please create a channel first and then try again."
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

    res.send("YouTube account connected successfully! Ab yeh tab band kar sakte ho.");
  } catch (error) {
    console.error(error);
    res.status(500).send("Error: " + error.message);
  }
};