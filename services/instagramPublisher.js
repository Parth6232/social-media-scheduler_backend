const axios = require("axios");
const ConnectedAccount = require("../models/ConnectedAccount");

const GRAPH_URL = "https://graph.facebook.com/v21.0";

async function publishToInstagram(userId, post, pageId) {
  // NAYA: agar pageId diya gaya hai (user ne dropdown se specific Instagram
  // account choose kiya), toh usi account ko dhundo. Agar nahi diya
  // (backward-compat, ya sirf 1 account connected hai), toh purana
  // behaviour jaisa pehla match lo.
  const filter = { userId, platform: "instagram" };
  if (pageId) filter.platformAccountId = pageId;

  const account = await ConnectedAccount.findOne(filter);

  if (!account) {
    throw new Error("Instagram account connected nahi hai");
  }

  if (!post.mediaUrl) {
    throw new Error("Instagram par post karne ke liye image ya video zaroori hai (text-only post Instagram par possible nahi hai)");
  }

  const igAccountId = account.platformAccountId;
  const accessToken = account.accessToken;

  const isVideo = /\.(mp4|mov|avi|mkv)$/i.test(post.mediaUrl);

  // NAYA: post.mediaUrl ab pehle se hi Cloudinary ka permanent public URL hai
  // (postController mein upload ho chuka hota hai), isliye yahan dobara upload
  // karne ki zaroorat nahi -- seedha use kar sakte hain.
  const publicMediaUrl = post.mediaUrl;

  try {
    // STEP 1: media container banao
    const containerParams = {
      access_token: accessToken,
    };

    // NAYA STEP 5: Instagram Stories API caption support nahi karta -- agar
    // caption bheja bhi jaaye toh silently ignore ho jaata hai, isliye
    // story ke liye bilkul nahi bhej rahe (galatfehmi door karne ke liye).
    if (post.postType !== "story") {
      containerParams.caption = post.content;
    }

    if (post.postType === "story") {
      // Story: image ya video dono ho sakte hain
      if (isVideo) containerParams.video_url = publicMediaUrl;
      else containerParams.image_url = publicMediaUrl;
      containerParams.media_type = "STORIES";
    } else if (isVideo) {
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
      let statusDetail = null;
      let attempts = 0;

      while (status === "IN_PROGRESS" && attempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // 5 second wait
        const statusRes = await axios.get(`${GRAPH_URL}/${creationId}`, {
          params: { fields: "status_code,status", access_token: accessToken },
        });
        status = statusRes.data.status_code;
        statusDetail = statusRes.data.status; // NAYA: actual error subcode/reason yahan milta hai
        attempts++;
      }

      if (status !== "FINISHED") {
        throw new Error(`Video processing complete nahi hui (status: ${status}${statusDetail ? `, detail: ${statusDetail}` : ""})`);
      }
    }

    // STEP 3: container ko publish karo
    const publishRes = await axios.post(`${GRAPH_URL}/${igAccountId}/media_publish`, null, {
      params: {
        creation_id: creationId,
        access_token: accessToken,
      },
    });

    return post.postType === "story"
      ? `Instagram Story published (id: ${publishRes.data.id}) -- 24hr mein expire ho jayegi`
      : `https://www.instagram.com/p/${publishRes.data.id}`;
  } catch (error) {
    const igError = error.response?.data?.error?.message || error.message;
    console.error("Instagram publish error:", error.response?.data || error.message);
    throw new Error(igError);
  }
}

module.exports = { publishToInstagram };