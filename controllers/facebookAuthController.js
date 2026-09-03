const axios = require("axios");
const ConnectedAccount = require("../models/ConnectedAccount");

const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI;

exports.redirectToFacebook = (req, res) => {
  const { userId } = req.query;

  const scopes = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish",
  ].join(",");

  const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT_URI}&scope=${scopes}&state=${userId}`;

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
      params: { access_token: longLivedToken },
    });

    const pages = pagesRes.data.data;

    if (!pages || pages.length === 0) {
      return res.status(400).send("Koi Facebook Page nahi mili. Pehle ek Facebook Page banao.");
    }

    const page = pages[0];

    await ConnectedAccount.findOneAndUpdate(
      { userId, platform: "facebook" },
      {
        userId,
        platform: "facebook",
        platformAccountId: page.id,
        displayName: page.name,
        accessToken: page.access_token,
      },
      { upsert: true, new: true }
    );

    const igRes = await axios.get(`https://graph.facebook.com/v21.0/${page.id}`, {
      params: { fields: "instagram_business_account", access_token: page.access_token },
    });

    if (igRes.data.instagram_business_account) {
      const igAccountId = igRes.data.instagram_business_account.id;

      await ConnectedAccount.findOneAndUpdate(
        { userId, platform: "instagram" },
        {
          userId,
          platform: "instagram",
          platformAccountId: igAccountId,
          displayName: page.name + " (Instagram)",
          accessToken: page.access_token,
        },
        { upsert: true, new: true }
      );

      return res.send("Facebook aur Instagram dono connect ho gaye! Ab yeh tab band kar sakte ho.");
    }

    res.send("Facebook connect ho gaya. Instagram Business account link nahi mila.");
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Error: " + (error.response?.data?.error?.message || error.message));
  }
};