const axios = require("axios");
const ConnectedAccount = require("../models/ConnectedAccount");

const GRAPH_URL = "https://graph.facebook.com/v21.0";

async function publishToInstagram(userId, post, pageId) {
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
  const publicMediaUrl = post.mediaUrl;

  try {
    const containerParams = {
      access_token: accessToken,
    };

    if (post.postType !== "story") {
      containerParams.caption = post.content;
    }

    if (post.postType === "story") {
      if (isVideo) containerParams.video_url = publicMediaUrl;
      else containerParams.image_url = publicMediaUrl;
      containerParams.media_type = "STORIES";
    } else if (isVideo) {
      containerParams.media_type = "REELS";
      containerParams.video_url = publicMediaUrl;
    } else {
      containerParams.image_url = publicMediaUrl;
    }

    // NAYA: Meta ke servers kabhi kabhi image/video URL fetch karne mein ya
    // video process karne mein fail ho jaate hain -- ye Meta ka khud ka
    // well-known intermittent issue hai (Cloudinary URL ya code ka fault
    // nahi). Isliye poora cycle -- container banao, aur video ho to uska
    // processing status check karo -- 3 baar tak retry karte hain. Video ke
    // case mein retry par NAYA container banana padta hai.
    const MAX_ATTEMPTS = 3;
    let creationId;
    let lastError;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const containerRes = await axios.post(`${GRAPH_URL}/${igAccountId}/media`, null, {
          params: containerParams,
        });
        creationId = containerRes.data.id;

        if (isVideo) {
          let status = "IN_PROGRESS";
          let statusDetail = null;
          let pollAttempts = 0;

          while (status === "IN_PROGRESS" && pollAttempts < 20) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            const statusRes = await axios.get(`${GRAPH_URL}/${creationId}`, {
              params: { fields: "status_code,status", access_token: accessToken },
            });
            status = statusRes.data.status_code;
            statusDetail = statusRes.data.status;
            pollAttempts++;
          }

          if (status !== "FINISHED") {
            throw new Error(`Video processing complete nahi hui (status: ${status}${statusDetail ? `, detail: ${statusDetail}` : ""})`);
          }
        }

        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        const metaMessage = err.response?.data?.error?.message || err.message || "";
        const isRetryableError =
          err.response?.data?.error?.code === 9004 ||
          err.response?.data?.error?.error_subcode === 2207076 ||
          /2207076/.test(metaMessage);

        if (attempt < MAX_ATTEMPTS && isRetryableError) {
          await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
          continue;
        }
        throw err;
      }
    }

    if (lastError) throw lastError;

    const publishRes = await axios.post(`${GRAPH_URL}/${igAccountId}/media_publish`, null, {
      params: {
        creation_id: creationId,
        access_token: accessToken,
      },
    });

    return post.postType === "story"
      ? { url: `Instagram Story published (id: ${publishRes.data.id}) -- 24hr mein expire ho jayegi`, platformPostId: publishRes.data.id }
      : { url: `https://www.instagram.com/p/${publishRes.data.id}`, platformPostId: publishRes.data.id };
  } catch (error) {
    const igError = error.response?.data?.error?.message || error.message;
    console.error("Instagram publish error:", error.response?.data || error.message);
    throw new Error(igError);
  }
}

module.exports = { publishToInstagram };