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
    const { platform, accountId } = req.params;

    // NAYA: agar accountId diya gaya hai (specific page/account), toh sirf
    // wahi ek document delete hoga. Agar accountId nahi diya (jaise YouTube,
    // jisme sirf ek hi account ho sakta hai), toh purane behaviour jaisa
    // us platform ke saare documents delete honge.
    const filter = { userId: req.userId, platform };
    if (accountId) {
      filter.platformAccountId = accountId;
    }

    const result = await ConnectedAccount.deleteMany(filter);

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Account nahi mila" });
    }

    res.json({ message: `${platform} disconnected successfully` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};