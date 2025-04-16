const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();
const dbPath = path.join(__dirname, "../database.json");

const loadDB = () => {
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  } catch (err) {
    console.error("Error loading database:", err);
    return { products: [], categories: [], users: [], stockHistory: [] };
  }
};

const saveDB = (data) => {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving database:", err);
  }
};

// Product Page
router.get("/:id", (req, res) => {
  const db = loadDB();
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.redirect("/");
  res.render("product", {
    product,
    users: db.users || [],
    user: req.user,
    categories: db.categories || [],
  });
});

// Add Review
router.post("/:id/review", (req, res) => {
  if (!req.user) return res.redirect("/auth/login");
  const db = loadDB();
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.redirect("/");

  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5 || !comment) {
    return res.render("product", {
      product,
      users: db.users || [],
      user: req.user,
      categories: db.categories || [],
      error: "Please provide a valid rating (1-5) and comment.",
    });
  }

  product.reviews = product.reviews || [];
  product.reviews.push({
    id: Date.now().toString(),
    userId: req.user.id,
    rating: parseInt(rating),
    comment,
    timestamp: new Date().toISOString(),
    edited: false,
  });

  saveDB(db);
  res.redirect(`/product/${req.params.id}`);
});

// Edit Review
router.post("/:id/review/edit", (req, res) => {
  if (!req.user) return res.redirect("/auth/login");
  const db = loadDB();
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.redirect("/");

  const { reviewId, rating, comment } = req.body;
  const review = product.reviews.find((r) => r.id === reviewId);
  if (!review || review.userId !== req.user.id) {
    return res.redirect(`/product/${req.params.id}`);
  }

  if (!rating || rating < 1 || rating > 5 || !comment) {
    return res.render("product", {
      product,
      users: db.users || [],
      user: req.user,
      categories: db.categories || [],
      error: "Please provide a valid rating (1-5) and comment.",
    });
  }

  review.rating = parseInt(rating);
  review.comment = comment;
  review.edited = true;
  review.timestamp = new Date().toISOString();

  saveDB(db);
  res.redirect(`/product/${req.params.id}`);
});

// Delete Review
router.post("/:id/review/delete", (req, res) => {
  if (!req.user) return res.redirect("/auth/login");
  const db = loadDB();
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.redirect("/");

  const { reviewId } = req.body;
  const review = product.reviews.find((r) => r.id === reviewId);
  if (!review || review.userId !== req.user.id) {
    return res.redirect(`/product/${req.params.id}`);
  }

  product.reviews = product.reviews.filter((r) => r.id !== reviewId);
  saveDB(db);
  res.redirect(`/product/${req.params.id}`);
});

module.exports = router;