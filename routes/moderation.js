const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const { contentFilter } = require("../middleware/contentFilter");

/**
 * Simple endpoint that reuses the contentFilter middleware to validate
 * arbitrary text against the forbidden-word rules and ML classifier.
 */
router.post("/test", authMiddleware, (req, res, next) => {
  // The content filter checks specific field names. Map "text" -> "content".
  if (typeof req.body?.text === "string" && !req.body.content) {
    req.body.content = req.body.text;
  }
  return contentFilter(req, res, (error) => {
    if (error) return next(error);
    return res.json({
      ok: true,
      message: "금지어가 감지되지 않았습니다.",
    });
  });
});

module.exports = router;
