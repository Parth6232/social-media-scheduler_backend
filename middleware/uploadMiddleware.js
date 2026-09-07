const multer = require("multer");

// NAYA: memoryStorage — file disk pe save NAHI hoti, seedha RAM mein buffer
// ke roop mein aati hai (req.file.buffer). Yehi buffer postController.js
// Cloudinary ko bhejta hai. Isse Render ke ephemeral disk ka issue khatam
// ho jata hai kyuki file kabhi disk ko touch hi nahi karti.
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB tak allow (video ke liye zaroori)
});

module.exports = upload;