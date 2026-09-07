require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const youtubeAuthRoutes = require("./routes/youtubeAuthRoutes");
const postRoutes = require("./routes/postRoutes");
const { startScheduler } = require("./services/scheduler");
const facebookAuthRoutes = require("./routes/facebookAuthRoutes");
const accountRoutes = require("./routes/accountRoutes");
const aiRoutes = require("./routes/aiRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));


app.get("/", (req, res) => {
  res.json({
    message: "Social Media Scheduler API is running"
  });
});
app.use('/api/auth', authRoutes);
app.use('/api/auth/youtube', youtubeAuthRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/auth/facebook', facebookAuthRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/ai', aiRoutes);
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected successfully");
    startScheduler(); // Scheduler ko start karna

    app.listen(process.env.PORT, () => {
      console.log(`Server running on http://localhost:${process.env.PORT}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
  });