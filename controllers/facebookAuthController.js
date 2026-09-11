const axios = require("axios");
const ConnectedAccount = require("../models/ConnectedAccount");

const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;
const CONFIG_ID = process.env.FACEBOOK_CONFIG_ID;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

// Glossy styled HTML result page jo OAuth ke baad dikhta hai, OK button ke saath
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

exports.redirectToFacebook = (req, res) => {
  const { userId } = req.query;

  // Facebook Login for Business ab config_id use karta hai,
  // scope permissions ab configuration ke andar hi predefined hain
  const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT_URI}&config_id=${CONFIG_ID}&state=${userId}`;

  res.redirect(url);
};

exports.facebookCallback = async (req, res) => {
  try {
    const { code, state: userId } = req.query;

    const tokenRes = await axios.get("https://graph.facebook.com/v21.0/oauth/access_token", {
      params: { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT_URI, code },
    });

    const shortLivedToken = tokenRes.data.access_token;

    const longTokenRes = await axios.get("https://graph.facebook.com/v21.0/oauth/access_token", {
      params: {
        grant_type: "fb_exchange_token",
        client_id: APP_ID,
        client_secret: APP_SECRET,
        fb_exchange_token: shortLivedToken,
      },
    });

    const longLivedToken = longTokenRes.data.access_token;

    const pagesRes = await axios.get("https://graph.facebook.com/v21.0/me/accounts", {
      // NAYA: "picture{url}" field add kiya taaki Page ki profile picture
      // bhi mil jaaye (default fields mein picture nahi aata)
      params: { access_token: longLivedToken, fields: "id,name,access_token,picture{url}" },
    });

    const pages = pagesRes.data.data;

    if (!pages || pages.length === 0) {
      return res
        .status(400)
        .send(renderResultPage("Page Not Found", "Koi Facebook Page nahi mili. Pehle ek Facebook Page banao.", false));
    }

    // NAYA: pehle sirf pages[0] (pehla page) save hota tha. Ab jitne bhi
    // pages user ke account se linked hain, sab ko loop karke alag-alag
    // ConnectedAccount documents ke roop mein save karte hain. Isi tarah
    // har page ka apna Instagram Business account (agar hai) bhi check
    // aur save hota hai.
    let savedFacebookCount = 0;
    let savedInstagramCount = 0;

    for (const page of pages) {
      await ConnectedAccount.findOneAndUpdate(
        { userId, platform: "facebook", platformAccountId: page.id },
        {
          userId,
          platform: "facebook",
          platformAccountId: page.id,
          displayName: page.name,
          profilePictureUrl: page.picture?.data?.url, // NAYA
          accessToken: page.access_token,
        },
        { upsert: true, new: true }
      );
      savedFacebookCount++;

      try {
        const igRes = await axios.get(`https://graph.facebook.com/v21.0/${page.id}`, {
          // NAYA: instagram_business_account ke andar profile_picture_url bhi
          // maang liya, ek hi call mein -- extra API round-trip nahi chahiye
          params: { fields: "instagram_business_account{id,profile_picture_url}", access_token: page.access_token },
        });

        if (igRes.data.instagram_business_account) {
          const igAccountId = igRes.data.instagram_business_account.id;
          const igProfilePic = igRes.data.instagram_business_account.profile_picture_url; // NAYA

          await ConnectedAccount.findOneAndUpdate(
            { userId, platform: "instagram", platformAccountId: igAccountId },
            {
              userId,
              platform: "instagram",
              platformAccountId: igAccountId,
              displayName: page.name + " (Instagram)",
              profilePictureUrl: igProfilePic, // NAYA
              accessToken: page.access_token,
            },
            { upsert: true, new: true }
          );
          savedInstagramCount++;
        }
      } catch (igErr) {
        // Ek page ka IG check fail ho bhi jaye, baaki pages process hote rahenge
        console.error(`Instagram check failed for page ${page.id}:`, igErr.response?.data || igErr.message);
      }
    }

    const parts = [`${savedFacebookCount} Facebook page${savedFacebookCount > 1 ? "s" : ""} connected`];
    if (savedInstagramCount > 0) {
      parts.push(`${savedInstagramCount} Instagram account${savedInstagramCount > 1 ? "s" : ""} connected`);
    }

    return res.send(renderResultPage("Success!", parts.join(" aur ") + ".", true));
  } catch (error) {
    const fbError = error.response?.data?.error?.message || error.message;
    console.error("Facebook OAuth error:", error.response?.data || error.message);
    res.status(500).send(renderResultPage("Connection Failed", fbError, false));
  }
};