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
  });
  if (req.user) {
    console.log(`Login page: User ${req.user.email} already logged in, redirecting to /`);
    return res.redirect("/");
  }
  res.render("login", { user: null });
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
  passport.authenticate("google", { failureRedirect: "/auth/login" }),
  (req, res, next) => {
    console.log(`Google callback: User ${req.user.email}`, {
      sessionID: req.sessionID,
      userID: req.user.id,
    });
    req.session.save((err) => {
      if (err) {
        console.error("Session save failed:", err);
        return next(err);
      }
      console.log("Session saved, redirecting to /");
      res.redirect("/");
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