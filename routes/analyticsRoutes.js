const express = require("express");
const router = express.Router();
const {
    getAnalyticsOverview,
    refreshAnalyticsStats,
    exportAnalyticsCsv,
} = require("../controllers/analyticsController");
const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware, getAnalyticsOverview);
router.post("/refresh", authMiddleware, refreshAnalyticsStats);
router.get("/export", authMiddleware, exportAnalyticsCsv);

module.exports = router;