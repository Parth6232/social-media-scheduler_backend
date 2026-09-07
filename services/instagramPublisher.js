const axios = require("axios");
const ConnectedAccount = require("../models/ConnectedAccount");
const cloudinary = require("../config/cloudinary"); // <-- NAYA: ngrok ki jagah Cloudinary

const GRAPH_URL = "https://graph.facebook.com/v21.0";

async function publishToInstagram(userId, post) {
  const account = await ConnectedAccount.findOne({ userId, platform: "instagram" });

  if (!account) {
    throw new Error("Instagram account connected nahi hai");
  }

  if (!post.mediaUrl) {
    throw new Error("Instagram par post karne ke liye image ya video zaroori hai (text-only post Instagram par possible nahi hai)");
  }

  const igAccountId = account.platformAccountId;
  const accessToken = account.accessToken;

  const isVideo = /\.(mp4|mov|avi|mkv)$/i.test(post.mediaUrl);

  // NAYA: local file (post.mediaUrl) ko Cloudinary par upload karke permanent
  // public HTTPS URL lo -- ab ngrok chalane ki ya PUBLIC_BASE_URL update karne
  // ki zaroorat nahi hai, yeh URL kabhi nahi badalta.
  let publicMediaUrl;
  try {
    const uploadResult = await cloudinary.uploader.upload(post.mediaUrl, {
      resource_type: isVideo ? "video" : "image",
      folder: "socialblitz_posts",
    });
    publicMediaUrl = uploadResult.secure_url;
  } catch (uploadError) {
    console.error("Cloudinary upload error:", uploadError.message);
    throw new Error("Media ko Cloudinary par upload karne mein error aayi: " + uploadError.message);
  }

  try {
    // STEP 1: media container banao
    const containerParams = {
      caption: post.content,
      access_token: accessToken,
    };

    if (isVideo) {
      containerParams.media_type = "REELS"; // Instagram par video = Reel
      containerParams.video_url = publicMediaUrl;
    } else {
      containerParams.image_url = publicMediaUrl;
    }

    const containerRes = await axios.post(`${GRAPH_URL}/${igAccountId}/media`, null, {
      params: containerParams,
    });

    const creationId = containerRes.data.id;

    // STEP 2: video ke liye processing complete hone ka wait karo
    if (isVideo) {
      let status = "IN_PROGRESS";
      let attempts = 0;

      while (status === "IN_PROGRESS" && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // 5 second wait
        const statusRes = await axios.get(`${GRAPH_URL}/${creationId}`, {
          params: { fields: "status_code", access_token: accessToken },
        });
        status = statusRes.data.status_code;
        attempts++;
      }

      if (status !== "FINISHED") {
        throw new Error(`Video processing complete nahi hui (status: ${status})`);
      }
    }

    // STEP 3: container ko publish karo
    const publishRes = await axios.post(`${GRAPH_URL}/${igAccountId}/media_publish`, null, {
      params: {
        creation_id: creationId,
        access_token: accessToken,
      },
    });

    return `https://www.instagram.com/p/${publishRes.data.id}`;
  } catch (error) {
    const igError = error.response?.data?.error?.message || error.message;
    console.error("Instagram publish error:", error.response?.data || error.message);
    throw new Error(igError);
  }
}

module.exports = { publishToInstagram };