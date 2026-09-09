const axios = require("axios");
const FormData = require("form-data");
const ConnectedAccount = require("../models/ConnectedAccount");

const GRAPH_URL = "https://graph.facebook.com/v21.0";
const GRAPH_VIDEO_URL = "https://graph-video.facebook.com/v21.0";

// NAYA: post.mediaUrl ab local file path nahi, Cloudinary ka remote https URL
// hota hai. Isliye fs.createReadStream() ki jagah is URL ko fetch karke uska
// stream Facebook ko forward karte hain.
async function getRemoteStream(url) {
  const response = await axios.get(url, { responseType: "stream" });
  return response.data;
}

async function publishToFacebook(userId, post, pageId) {
  // NAYA: agar pageId diya gaya hai (user ne dropdown se specific page choose
  // kiya), toh usi page ka account dhundo. Agar nahi diya (backward-compat,
  // ya sirf 1 page connected hai), toh purane behaviour jaisa pehla match lo.
  const filter = { userId, platform: "facebook" };
  if (pageId) filter.platformAccountId = pageId;

  const account = await ConnectedAccount.findOne(filter);

  if (!account) {
    throw new Error("Facebook account connected nahi hai");
  }

  // account.platformAccountId hi actual page ID hai jispar post jayega —
  // pageId param se match hi kiya gaya (upar filter mein), isliye use
  // account se hi le rahe hain taaki single-source-of-truth rahe.
  pageId = account.platformAccountId;
  const accessToken = account.accessToken;

  try {
    // Case 1: sirf text post, koi media nahi
    if (!post.mediaUrl) {
      const response = await axios.post(`${GRAPH_URL}/${pageId}/feed`, null, {
        params: {
          message: post.content,
          access_token: accessToken,
        },
      });
      return `https://www.facebook.com/${response.data.id}`;
    }

    const isVideo = /\.(mp4|mov|avi|mkv)$/i.test(post.mediaUrl);

    // Case 2: video post
    if (isVideo) {
      const form = new FormData();
      form.append("description", post.content);
      form.append("access_token", accessToken);
      form.append("source", await getRemoteStream(post.mediaUrl));

      const response = await axios.post(`${GRAPH_VIDEO_URL}/${pageId}/videos`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      return `https://www.facebook.com/${pageId}/videos/${response.data.id}`;
    }

    // Case 3: image post
    const form = new FormData();
    form.append("caption", post.content);
    form.append("access_token", accessToken);
    form.append("source", await getRemoteStream(post.mediaUrl));

    const response = await axios.post(`${GRAPH_URL}/${pageId}/photos`, form, {
      headers: form.getHeaders(),
    });

    return `https://www.facebook.com/${response.data.post_id || response.data.id}`;
  } catch (error) {
    const fbError = error.response?.data?.error?.message || error.message;
    console.error("Facebook publish error:", error.response?.data || error.message);
    throw new Error(fbError);
  }
}

module.exports = { publishToFacebook };