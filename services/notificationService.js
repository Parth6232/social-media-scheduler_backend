const User = require("../models/User");
const { sendPostNotificationEmail } = require("../utils/sendEmail");

// Post ke event par email bhejta hai -- SIRF agar user ne notification ON kiya ho.
// Ye function kabhi throw nahi karta: email fail ho jaye to bhi post ka kaam nahi rukna chahiye.
// event: "scheduled" | "published" | "partial" | "failed"
async function notifyPostEvent(post, event) {
    try {
        if (!event) return;
        const user = await User.findById(post.userId).select("email emailNotifications");
        if (!user || user.emailNotifications !== true) return;

        await sendPostNotificationEmail(user.email, {
            event,
            content: post.content,
            scheduledAt: post.scheduledAt,
            targets: post.targets.map((t) => ({
                platform: t.platform,
                status: t.status,
                publishedUrl: t.publishedUrl,
                error: t.error,
            })),
        });
    } catch (error) {
        console.error(`Post notification email failed (${event}):`, error.message);
    }
}

module.exports = { notifyPostEvent };