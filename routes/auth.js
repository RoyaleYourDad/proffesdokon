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
  if (req.user) {
    console.log(`Login page: User ${req.user.email} already logged in, redirecting to /`);
    return res.redirect("/");
  }
  res.render("login", { user: null });
});

// GET /auth/google
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// GET /auth/google/callback
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/auth/login" }),
  (req, res) => {
    console.log(`Google callback: Redirecting user ${req.user.email} to /`);
    res.redirect("/");
  }
);

// GET /auth/logout
router.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

module.exports = router;