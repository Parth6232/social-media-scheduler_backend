const ConnectedAccount = require("../models/ConnectedAccount");

// Logged-in user ke saare connected accounts return karo (tokens ke bina — security ke liye)
exports.getMyAccounts = async (req, res) => {
  try {
    const accounts = await ConnectedAccount.find({ userId: req.userId }).select(
      "-accessToken -refreshToken"
    );
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.disconnectAccount = async (req, res) => {
  try {
    const { platform } = req.params;
    await ConnectedAccount.findOneAndDelete({ userId: req.userId, platform });
    res.json({ message: `${platform} disconnected successfully` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};