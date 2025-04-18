const express = require("express");
const router = express.Router();
const passport = require("passport");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "../database.json");

const loadDB = () => {
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  } catch (err) {
    console.error("Error loading database:", err);
    return { users: [], products: [], categories: [] };
  }
};

const saveDB = (data) => {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving database:", err);
  }
};

// GET /auth/login
router.get("/login", (req, res) => {
  console.log("Accessing /auth/login", {
    sessionID: req.sessionID,
    user: req.user ? req.user.email : "No user",
    error: req.query.error || null,
  });
  if (req.user) {
    console.log(`Login page: User ${req.user.email} already logged in, redirecting to /`);
    return res.redirect("/");
  }
  res.render("login", {
    user: null,
    query: req.query || {},
    error: req.query.error || null,
  });
});

// GET /auth/google
router.get(
  "/google",
  (req, res, next) => {
    console.log("Initiating Google auth", { sessionID: req.sessionID });
    passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
  }
);

// GET /auth/google/callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/auth/login?error=auth_failed",
  }),
  (req, res) => {
    console.log("Google callback session:", {
      sessionID: req.sessionID,
      user: req.user ? { id: req.user.id, email: req.user.email } : "No user",
      session: req.session,
    });
    req.session.save((err) => {
      if (err) {
        console.error("Session save failed:", {
          error: err.message,
          stack: err.stack,
        });
        if (!res.headersSent) {
          return res.status(500).render("error", {
            message: "Failed to save session. Please try again.",
            user: req.user,
            query: req.query || {},
          });
        }
        console.warn("Headers already sent, skipping error response");
        return;
      }
      console.log("Session saved, redirecting to /");
      if (!res.headersSent) {
        res.redirect("/");
      }
    });
  }
);

// GET /auth/logout
router.get("/logout", (req, res, next) => {
  console.log("Logging out", {
    sessionID: req.sessionID,
    user: req.user ? req.user.email : "No user",
  });
  req.logout((err) => {
    if (err) {
      console.error("Logout error:", err);
      return next(err);
    }
    req.session.destroy((err) => {
      if (err) {
        console.error("Session destroy failed:", err);
        return next(err);
      }
      console.log("Session destroyed, redirecting to /");
      res.redirect("/");
    });
  });
});

module.exports = router;