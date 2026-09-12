const Post = require("../models/Post");
const { publishToYouTube } = require("../services/youtubePublisher");
const { publishToFacebook } = require("../services/facebookPublisher");
const { publishToInstagram } = require("../services/instagramPublisher");
const { refreshStatsForPost } = require("../services/statsService"); // NAYA
const cloudinary = require("../config/cloudinary");
const { POST_RULES, isPlatformAllowed, isMediaTypeValid, isPlatformMediaCompatible } = require("../config/postRules");

// file ka buffer (memory storage se) seedha Cloudinary par upload karta hai.
// Local disk ka use hi nahi hota, isliye Render/koi bhi free hosting pe safe hai.
function uploadBufferToCloudinary(buffer, isVideo) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: isVideo ? "video" : "image", folder: "socialblitz_posts" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    stream.end(buffer);
  });
}

async function publishPostNow(post) {
  post.status = "processing";
  await post.save();

  for (const target of post.targets) {
    try {
      // NAYA: teeno publisher functions ab { url, platformPostId } object
      // return karte hain (pehle sirf url string thi) -- platformPostId
      // stats fetch karne ke liye chahiye (views/likes).
      let result;
      if (target.platform === "youtube") {
        result = await publishToYouTube(post.userId, post);
      } else if (target.platform === "facebook") {
        // NAYA: target.pageId batata hai kaunse specific Facebook page par post karna hai
        result = await publishToFacebook(post.userId, post, target.pageId);
      } else if (target.platform === "instagram") {
        // NAYA: target.pageId batata hai kaunse specific Instagram business account par post karna hai
        result = await publishToInstagram(post.userId, post, target.pageId);
      } else {
        target.status = "failed";
        target.error = "Platform abhi supported nahi hai";
        continue;
      }
      target.status = "published";
      target.publishedUrl = result.url;
      target.platformPostId = result.platformPostId;
    } catch (error) {
      target.status = "failed";
      target.error = error.message;
    }
  }

  const allDone = post.targets.every((t) => t.status !== "pending");
  // PURANA (bug): sirf "koi pending nahi bacha" check hota tha, isliye ek
  // target fail hone par bhi overall post "completed" dikh jaata tha.
  // post.status = allDone ? "completed" : "failed";

  // NAYA: ab teen states possible hain --
  //   - "completed" = SAB targets published (real success)
  //   - "failed"    = SAB targets fail hue
  //   - "partial"   = kuch published, kuch fail (jaisa screenshot mein hua tha)
  // Isse Posts History mein "Completed" tabhi dikhega jab wakai sab platforms
  // par post ho chuka ho.
  if (allDone) {
    const allPublished = post.targets.every((t) => t.status === "published");
    const allFailed = post.targets.every((t) => t.status === "failed");
    post.status = allPublished ? "completed" : allFailed ? "failed" : "partial";
  } else {
    post.status = "failed"; // safety net, normally yahan aana nahi chahiye
  }
  await post.save();

  console.log(`✅ Post ${post._id} published`);
}

exports.createPost = async (req, res) => {
  try {
    console.log("BODY RECEIVED:", req.body);
    // NAYA: facebookPageId aur instagramPageId — frontend se aate hain jab
    // user ke multiple Facebook pages / Instagram accounts connected hon
    // aur usne dropdown se ek specific page choose kiya ho.
    // postType: "feed" (purana default), "reel", ya "story"
    const { content, scheduledAt, platforms, privacy, facebookPageId, instagramPageId } = req.body;
    const postType = req.body.postType || "feed";
    const userId = req.userId;

    if (!content || !platforms) {
      return res.status(400).json({ message: "content aur platforms zaroori hain" });
    }

    const platformsArray = JSON.parse(platforms);

    // NAYA STEP 3: postType valid hai ya nahi check karo
    const rule = POST_RULES[postType];
    if (!rule) {
      return res.status(400).json({ message: `Invalid postType: ${postType}` });
    }

    // NAYA STEP 3: har selected platform is postType ke liye allowed hai ya nahi
    const invalidPlatforms = platformsArray.filter((p) => !isPlatformAllowed(postType, p));
    if (invalidPlatforms.length > 0) {
      return res.status(400).json({
        message: `${rule.label} sirf inn platforms par post ho sakta hai: ${rule.allowedPlatforms.join(", ")}. Ye allowed nahi: ${invalidPlatforms.join(", ")}`,
      });
    }

    // NAYA STEP 3: media zaroori hai ya nahi, aur sahi type (image/video) hai ya nahi
    if (rule.requiresMedia && !req.file) {
      return res.status(400).json({ message: `${rule.label} ke liye media (image/video) zaroori hai` });
    }

    // NAYA STEP 4: PLATFORM-LEVEL media compatibility check.
    // Ye "feed" (Post) postType ke liye zaroori hai kyunki wahan mediaType
    // "both" + requiresMedia false hai, isliye koi bhi platform combination
    // + koi bhi media (ya media hi na ho) validate ho jaata tha upar wale
    // checks se -- lekin YouTube kabhi text/photo accept nahi karta aur
    // Instagram kabhi text-only accept nahi karta, isliye ye publish-time
    // par fail hota tha. Ab yahin, save hone se pehle, reject karte hain.
    const mediaKind = !req.file ? "none" : req.file.mimetype.startsWith("video/") ? "video" : "image";
    const incompatiblePlatforms = platformsArray.filter((p) => !isPlatformMediaCompatible(p, mediaKind));
    if (incompatiblePlatforms.length > 0) {
      const mediaLabel = mediaKind === "none" ? "text-only" : mediaKind === "image" ? "photo" : "video";
      return res.status(400).json({
        message: `${incompatiblePlatforms.join(", ")} par ${mediaLabel} post nahi ho sakta. Inn platforms ko hata do ya media badal do.`,
      });
    }

    let mediaUrl = null;
    if (req.file) {
      const isVideo = req.file.mimetype.startsWith("video/");

      if (!isMediaTypeValid(postType, isVideo)) {
        const mediaMsg =
          rule.mediaType === "none"
            ? "koi bhi media (image/video) allowed nahi hai, sirf text bhejo"
            : `sirf ${rule.mediaType === "video" ? "video" : "image"} allowed hai`;
        return res.status(400).json({ message: `${rule.label} ke liye ${mediaMsg}` });
      }

      const uploadResult = await uploadBufferToCloudinary(req.file.buffer, isVideo);
      mediaUrl = uploadResult.secure_url;

      // NAYA STEP 3: duration check -- Cloudinary video upload response mein
      // "duration" (seconds) already milta hai, isliye alag se ffprobe nahi chahiye
      if (isVideo && rule.maxDurationSeconds && uploadResult.duration > rule.maxDurationSeconds) {
        return res.status(400).json({
          message: `${rule.label} ke liye video ${rule.maxDurationSeconds} second se lamba nahi ho sakta (aapka video: ${Math.round(uploadResult.duration)} second)`,
        });
      }
    }

    // NAYA: har target ke saath uska pageId bhi save karte hain (agar diya gaya ho)
    const targets = platformsArray.map((platform) => {
      const target = { platform, status: "pending" };
      if (platform === "facebook" && facebookPageId) target.pageId = facebookPageId;
      if (platform === "instagram" && instagramPageId) target.pageId = instagramPageId;
      return target;
    });

    const isInstant = !scheduledAt;
    const finalScheduledAt = isInstant ? new Date() : new Date(scheduledAt);

    const post = await Post.create({
      userId,
      content,
      mediaUrl,
      postType,
      scheduledAt: finalScheduledAt,
      privacy: privacy || "private",
      targets,
    });

    if (isInstant) {
      publishPostNow(post);
    }

    res.status(201).json({ message: "Post created", post, instant: isInstant });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getMyPosts = async (req, res) => {
  try {
    // NAYA: ?platform=instagram diya jaaye toh sirf wahi posts aayenge jinke
    // targets mein us platform ka entry ho. Post History ke naye "pehle
    // platform choose karo, phir uske posts dekho" UI ke liye zaroori.
    const { platform } = req.query;
    const filter = { userId: req.userId };
    if (platform) filter["targets.platform"] = platform;

    const posts = await Post.find(filter).sort({ scheduledAt: -1 });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// NAYA: Post History ke pehle screen ke liye -- har platform ke against
// kitne posts hain aur unme se kitne success/fail hue, taaki
// YouTube/Instagram/Facebook (aur future LinkedIn/Twitter/WhatsApp) cards
// par turant ek quick summary dikhaya ja sake, bina sab posts frontend
// mein loop kiye.
exports.getPlatformSummary = async (req, res) => {
  try {
    const posts = await Post.find({ userId: req.userId });
    const summary = {};

    for (const post of posts) {
      for (const target of post.targets) {
        if (!summary[target.platform]) {
          summary[target.platform] = { total: 0, published: 0, failed: 0, pending: 0 };
        }
        summary[target.platform].total++;
        if (target.status === "published") summary[target.platform].published++;
        else if (target.status === "failed") summary[target.platform].failed++;
        else summary[target.platform].pending++;
      }
    }

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.publishPostNow = publishPostNow;

// NAYA: Manual "Refresh stats" button ke liye -- ek specific post ke
// views/likes turant refresh karo (sirf apna hi post refresh kar sake,
// userId match check ke saath).
exports.refreshPostStats = async (req, res) => {
  try {
    const post = await Post.findOne({ _id: req.params.id, userId: req.userId });
    if (!post) {
      return res.status(404).json({ message: "Post nahi mila" });
    }
    await refreshStatsForPost(post);
    res.json({ message: "Stats refresh ho gaye", post });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// NAYA: Post History se ek specific platform-target hatane ke liye (user
// ka apna manual delete button). Sirf hamare record se hataता hai --
// asli platform (Facebook/Instagram/YouTube) par kuch delete nahi hota.
exports.deletePostTarget = async (req, res) => {
  try {
    const { id, platform } = req.params;
    const post = await Post.findOne({ _id: id, userId: req.userId });
    if (!post) {
      return res.status(404).json({ message: "Post nahi mila" });
    }

    const targetIndex = post.targets.findIndex((t) => t.platform === platform);
    if (targetIndex === -1) {
      return res.status(404).json({ message: "Is platform ka target nahi mila" });
    }

    post.targets.splice(targetIndex, 1);

    // Agar ye is post ka aakhri target tha, to poori post hi hata do
    if (post.targets.length === 0) {
      await Post.deleteOne({ _id: post._id });
      return res.json({ message: "Post history se hata diya gaya", deleted: true });
    }

    // NAYA: target delete hone ke baad post.status STALE reh jaata tha
    // (jaise "partial" hamesha ke liye, chahe baaki sab platforms published
    // hi kyun na hon) -- isliye baaki bache hue targets ke hisaab se status
    // ko dobara calculate karo, bilkul publishPostNow() wali hi logic se.
    const remaining = post.targets;
    const allDone = remaining.every((t) => t.status !== "pending");
    if (allDone) {
      const allPublished = remaining.every((t) => t.status === "published");
      const allFailed = remaining.every((t) => t.status === "failed");
      post.status = allPublished ? "completed" : allFailed ? "failed" : "partial";
    }

    await post.save();
    res.json({ message: "Platform history se hata diya gaya", deleted: false, post });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};