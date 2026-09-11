const cron = require("node-cron");
const Post = require("../models/Post");
const { publishPostNow } = require("../controllers/postController");
const { refreshStatsForPost } = require("./statsService"); // NAYA

function startScheduler() {
  cron.schedule("* * * * *", async () => {
    const now = new Date();

    const duePosts = await Post.find({
      status: "pending",
      scheduledAt: { $lte: now },
    });

    for (const post of duePosts) {
      await publishPostNow(post); // console.log iske andar hi ho jayega
    }
  });

  // NAYA: "day change hone par" -- roz raat 12:00 baje (server timezone),
  // har us post ke stats refresh karo jisme kam se kam ek "published"
  // target ho. Manual button wala hi function reuse ho raha hai.
  cron.schedule("0 0 * * *", async () => {
    console.log("Daily stats refresh shuru ho raha hai...");
    const postsToRefresh = await Post.find({ "targets.status": "published" });

    for (const post of postsToRefresh) {
      try {
        await refreshStatsForPost(post);
      } catch (error) {
        console.error(`Stats refresh failed for post ${post._id}:`, error.message);
      }
    }
    console.log(`Daily stats refresh complete -- ${postsToRefresh.length} posts check kiye`);
  });

  console.log("Scheduler started — har minute publish check, aur roz stats refresh karega");
}

module.exports = { startScheduler };