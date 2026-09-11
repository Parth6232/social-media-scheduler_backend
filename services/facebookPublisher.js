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

  // NAYA STEP 4: postType ke hisaab se sahi publish-flow chuno.
  // "feed" (ya postType missing, purane posts ke liye) = purana normal behaviour.
  if (post.postType === "reel") {
    return publishFacebookReel(pageId, accessToken, post);
  }
  if (post.postType === "story") {
    return publishFacebookStory(pageId, accessToken, post);
  }

  try {
    // Case 1: sirf text post, koi media nahi
    if (!post.mediaUrl) {
      const response = await axios.post(`${GRAPH_URL}/${pageId}/feed`, null, {
        params: {
          message: post.content,
          access_token: accessToken,
        },
      });
      return { url: `https://www.facebook.com/${response.data.id}`, platformPostId: response.data.id };
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

      return { url: `https://www.facebook.com/${pageId}/videos/${response.data.id}`, platformPostId: response.data.id };
    }

    // Case 3: image post
    const form = new FormData();
    form.append("caption", post.content);
    form.append("access_token", accessToken);
    form.append("source", await getRemoteStream(post.mediaUrl));

    const response = await axios.post(`${GRAPH_URL}/${pageId}/photos`, form, {
      headers: form.getHeaders(),
    });

    return { url: `https://www.facebook.com/${response.data.post_id || response.data.id}`, platformPostId: response.data.post_id || response.data.id };
  } catch (error) {
    const fbError = error.response?.data?.error?.message || error.message;
    console.error("Facebook publish error:", error.response?.data || error.message);
    throw new Error(fbError);
  }
}

// NAYA: video upload session start -> hosted file (Cloudinary URL) transfer
// -> processing poll -> finish/publish. Reels aur Video-Stories dono isi
// 3-step pattern ko follow karte hain (sirf endpoint "video_reels" vs
// "video_stories" alag hota hai), isliye ek common helper bana diya.
async function uploadFacebookVideoSession(endpointBase, pageId, accessToken, post) {
  // Step 1: session start karo
  const startRes = await axios.post(`${GRAPH_URL}/${pageId}/${endpointBase}`, null, {
    params: { upload_phase: "start", access_token: accessToken },
  });
  const { video_id, upload_url } = startRes.data;

  // Step 2: hosted file (Cloudinary ka public URL) ko file_url header ke
  // through transfer karo -- humein khud file download-reupload nahi karna
  // padta, Facebook seedha Cloudinary se fetch kar leta hai.
  await axios.post(upload_url, null, {
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_url: post.mediaUrl,
    },
  });

  // Step 3: processing poll karo -- Meta docs/community ke hisaab se kabhi
  // kabhi processing_phase lambe time tak "not_started"/"in_progress" reh
  // sakta hai. Best practice: sirf uploading_phase ke "complete" hone ka
  // wait karo, phir publish/finish call kar do (processing background mein
  // khud complete ho jaata hai).
  let uploadingDone = false;
  for (let attempts = 0; attempts < 12 && !uploadingDone; attempts++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const statusRes = await axios.get(`${GRAPH_URL}/${video_id}`, {
      params: { fields: "status", access_token: accessToken },
    });
    uploadingDone = statusRes.data.status?.uploading_phase?.status === "complete";

    const processingError = statusRes.data.status?.processing_phase?.error;
    if (processingError) {
      throw new Error(processingError.message || "Video processing failed");
    }
  }

  if (!uploadingDone) {
    throw new Error("Video upload complete nahi hua 60 second mein -- file bahut badi/lambi ho sakti hai");
  }

  return video_id;
}

// NAYA: Facebook Reel publish karna
async function publishFacebookReel(pageId, accessToken, post) {
  try {
    const video_id = await uploadFacebookVideoSession("video_reels", pageId, accessToken, post);

    await axios.post(`${GRAPH_URL}/${pageId}/video_reels`, null, {
      params: {
        upload_phase: "finish",
        video_id,
        video_state: "PUBLISHED",
        description: post.content,
        access_token: accessToken,
      },
    });

    return { url: `https://www.facebook.com/reel/${video_id}`, platformPostId: video_id };
  } catch (error) {
    const fbError = error.response?.data?.error?.message || error.message;
    console.error("Facebook Reel publish error:", error.response?.data || error.message);
    throw new Error(fbError);
  }
}

// NAYA: Facebook Story publish karna (image ya video, dono handle karta hai)
async function publishFacebookStory(pageId, accessToken, post) {
  try {
    const isVideo = /\.(mp4|mov|avi|mkv)$/i.test(post.mediaUrl);

    if (isVideo) {
      const video_id = await uploadFacebookVideoSession("video_stories", pageId, accessToken, post);

      const finishRes = await axios.post(`${GRAPH_URL}/${pageId}/video_stories`, null, {
        params: { upload_phase: "finish", video_id, access_token: accessToken },
      });

      return { url: `https://www.facebook.com/${finishRes.data.post_id || pageId}`, platformPostId: finishRes.data.post_id || video_id };
    }

    // Photo story: pehle photo upload karo (published:false), phir photo_stories se publish
    const photoRes = await axios.post(`${GRAPH_URL}/${pageId}/photos`, null, {
      params: { url: post.mediaUrl, published: "false", access_token: accessToken },
    });
    const photo_id = photoRes.data.id;

    const storyRes = await axios.post(`${GRAPH_URL}/${pageId}/photo_stories`, null, {
      params: { photo_id, access_token: accessToken },
    });

    return { url: `https://www.facebook.com/${storyRes.data.post_id || pageId}`, platformPostId: storyRes.data.post_id || photo_id };
  } catch (error) {
    const fbError = error.response?.data?.error?.message || error.message;
    console.error("Facebook Story publish error:", error.response?.data || error.message);
    throw new Error(fbError);
  }
}

module.exports = { publishToFacebook };