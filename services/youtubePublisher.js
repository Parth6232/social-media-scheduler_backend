const { google } = require("googleapis");
const axios = require("axios");
const ConnectedAccount = require("../models/ConnectedAccount");

async function publishToYouTube(userId, post) {
  const account = await ConnectedAccount.findOne({ userId, platform: "youtube" });

  if (!account) {
    throw new Error("YouTube account connected nahi hai");
  }

  if (!post.mediaUrl) {
    throw new Error("YouTube par post karne ke liye video file chahiye (mediaUrl missing)");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: account.refreshToken, // sirf refresh_token dena kaafi hai
  });

  // NAYA: fresh access token mangwao refresh_token se
  const { credentials } = await oauth2Client.refreshAccessToken();
  oauth2Client.setCredentials(credentials);

  // naya token DB mein update kar do future ke liye
  account.accessToken = credentials.access_token;
  account.tokenExpiresAt = new Date(credentials.expiry_date);
  await account.save();

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  // NAYA: post.mediaUrl ab Cloudinary ka remote https URL hota hai (local
  // file nahi), isliye usse fetch karke stream ke roop mein YouTube ko dete hain.
  const mediaStream = (await axios.get(post.mediaUrl, { responseType: "stream" })).data;

  const response = await youtube.videos.insert({
    part: "snippet,status",
    requestBody: {
      snippet: {
        title: post.content.slice(0, 90) || "Untitled",
        description: post.content,
      },
      status: {
        privacyStatus: post.privacy || "private", // <-- YEH CHANGE
      },
    },
    media: {
      body: mediaStream,
    },
  });

  return `https://youtube.com/watch?v=${response.data.id}`;
}

module.exports = { publishToYouTube };