const Post = require("../models/Post");
const { publishToYouTube } = require("../services/youtubePublisher");
const { publishToFacebook } = require("../services/facebookPublisher");
const { publishToInstagram } = require("../services/instagramPublisher");
const cloudinary = require("../config/cloudinary");

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
      if (target.platform === "youtube") {
        const url = await publishToYouTube(post.userId, post);
        target.status = "published";
        target.publishedUrl = url;
      } else if (target.platform === "facebook") {
        // NAYA: target.pageId batata hai kaunse specific Facebook page par post karna hai
        const url = await publishToFacebook(post.userId, post, target.pageId);
        target.status = "published";
        target.publishedUrl = url;
      } else if (target.platform === "instagram") {
        // NAYA: target.pageId batata hai kaunse specific Instagram business account par post karna hai
        const url = await publishToInstagram(post.userId, post, target.pageId);
        target.status = "published";
        target.publishedUrl = url;
      } else {
        target.status = "failed";
        target.error = "Platform abhi supported nahi hai";
      }
    } catch (error) {
      target.status = "failed";
      target.error = error.message;
    }
  }

  const allDone = post.targets.every((t) => t.status !== "pending");
  post.status = allDone ? "completed" : "failed";
  await post.save();

  console.log(`✅ Post ${post._id} published`);
}

exports.createPost = async (req, res) => {
  try {
    console.log("BODY RECEIVED:", req.body);
    // NAYA: facebookPageId aur instagramPageId — frontend se aate hain jab
    // user ke multiple Facebook pages / Instagram accounts connected hon
    // aur usne dropdown se ek specific page choose kiya ho.
    const { content, scheduledAt, platforms, privacy, facebookPageId, instagramPageId } = req.body;
    const userId = req.userId;

    let mediaUrl = null;
    if (req.file) {
      const isVideo = req.file.mimetype.startsWith("video/");
      const uploadResult = await uploadBufferToCloudinary(req.file.buffer, isVideo);
      mediaUrl = uploadResult.secure_url;
    }

    if (!content || !platforms) {
      return res.status(400).json({ message: "content aur platforms zaroori hain" });
    }

    const platformsArray = JSON.parse(platforms);

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
    const posts = await Post.find({ userId: req.userId }).sort({ scheduledAt: -1 });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.publishPostNow = publishPostNow;