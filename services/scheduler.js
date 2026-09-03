const cron = require("node-cron");
const Post = require("../models/Post");
const { publishPostNow } = require("../controllers/postController");

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

  console.log("Scheduler started — har minute check karega");
}

module.exports = { startScheduler };