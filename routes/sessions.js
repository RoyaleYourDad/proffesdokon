const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const os = require("os");

const sessionPath = path.join(os.tmpdir(), "sessions");

// GET /sessions - List all session files
router.get("/", (req, res) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).render("error", {
      message: "Access denied: Admin privileges required",
      user: req.user,
      query: req.query || {},
    });
  }

  try {
    const sessionFiles = fs
      .readdirSync(sessionPath)
      .filter((file) => file.endsWith(".json"))
      .map((file) => ({
        name: file,
        stats: fs.statSync(path.join(sessionPath, file)),
      }));
    res.render("sessions", {
      user: req.user,
      query: req.query || {},
      sessionFiles,
      sessionPath,
    });
  } catch (err) {
    console.error("Error reading sessions directory:", {
      path: sessionPath,
      error: err.message,
      stack: err.stack,
    });
    res.status(500).render("error", {
      message: "Failed to load sessions directory",
      user: req.user,
      query: req.query || {},
    });
  }
});

// GET /sessions/:sessionId - View or download a session file
router.get("/:sessionId", (req, res) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).render("error", {
      message: "Access denied: Admin privileges required",
      user: req.user,
      query: req.query || {},
    });
  }

  const sessionFile = path.join(sessionPath, req.params.sessionId);
  if (!sessionFile.endsWith(".json")) {
    return res.status(400).render("error", {
      message: "Invalid session file",
      user: req.user,
      query: req.query || {},
    });
  }

  try {
    if (!fs.existsSync(sessionFile)) {
      return res.status(404).render("error", {
        message: "Session file not found",
        user: req.user,
        query: req.query || {},
      });
    }

    if (req.query.download === "true") {
      // Trigger download
      res.download(sessionFile, req.params.sessionId, (err) => {
        if (err) {
          console.error("Error downloading session file:", {
            file: sessionFile,
            error: err.message,
            stack: err.stack,
          });
          if (!res.headersSent) {
            res.status(500).render("error", {
              message: "Failed to download session file",
              user: req.user,
              query: req.query || {},
            });
          }
        }
      });
    } else {
      // Serve raw content
      const content = fs.readFileSync(sessionFile, "utf8");
      res.setHeader("Content-Type", "application/json");
      res.send(content);
    }
  } catch (err) {
    console.error("Error accessing session file:", {
      file: sessionFile,
      error: err.message,
      stack: err.stack,
    });
    res.status(500).render("error", {
      message: "Failed to access session file",
      user: req.user,
      query: req.query || {},
    });
  }
});

module.exports = router;