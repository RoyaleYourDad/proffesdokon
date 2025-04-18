const express = require("express");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const dbPath = path.join(__dirname, "../database.json");

const loadDB = () => {
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  } catch (err) {
    console.error("Error loading database:", {
      path: dbPath,
      error: err.message,
      stack: err.stack,
    });
    return { products: [], categories: [], users: [], stockHistory: [] };
  }
};

const saveDB = (data) => {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving database:", {
      path: dbPath,
      error: err.message,
      stack: err.stack,
    });
  }
};

// Product Page
router.get("/:id", (req, res, next) => {
  try {
    const db = loadDB();
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product) {
      console.warn(`Product not found: ${req.params.id}`);
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
        query: req.query || {},
      });
    }
    console.log(`Rendering product: ${product.name} (ID: ${product.id})`);
    res.render("product", {
      product,
      users: db.users || [],
      user: req.user,
      categories: db.categories || [],
      editReview: null,
      query: req.query || {},
    });
  } catch (err) {
    console.error("Error in product route:", {
      error: err.message,
      stack: err.stack,
      productId: req.params.id,
    });
    next(err);
  }
});

// Add Review
router.post("/:id/review", (req, res, next) => {
  try {
    if (!req.user) return res.redirect("/auth/login");
    const db = loadDB();
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product) {
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
        query: req.query || {},
      });
    }

    product.reviews = product.reviews || [];
    if (product.reviews.some((r) => r.userId === req.user.id)) {
      return res.render("product", {
        product,
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        editReview: null,
        error: "You have already reviewed this product.",
        query: req.query || {},
      });
    }

    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5 || !comment) {
      return res.render("product", {
        product,
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        editReview: null,
        error: "Please provide a valid rating (1-5) and comment.",
        query: req.query || {},
      });
    }

    product.reviews.push({
      id: uuidv4(),
      userId: req.user.id,
      rating: parseInt(rating),
      comment,
      timestamp: new Date().toISOString(),
      edited: false,
    });

    saveDB(db);
    res.redirect(`/product/${req.params.id}`);
  } catch (err) {
    console.error("Error in add review route:", {
      error: err.message,
      stack: err.stack,
      productId: req.params.id,
    });
    next(err);
  }
});

// Render Edit Review Form
router.get("/:id/review/edit/:reviewId", (req, res, next) => {
  try {
    if (!req.user) {
      console.log("Edit review: User not authenticated, redirecting to login");
      return res.redirect("/auth/login");
    }
    const db = loadDB();
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product) {
      console.warn(`Edit review: Product not found: ${req.params.id}`);
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
        query: req.query || {},
      });
    }
    const review = product.reviews.find((r) => r.id === req.params.reviewId);
    if (!review) {
      console.warn(`Edit review: Review not found: ${req.params.reviewId}`);
      return res.redirect(`/product/${req.params.id}`);
    }
    if (review.userId !== req.user.id) {
      console.warn(`Edit review: User ${req.user.id} not authorized for review ${req.params.reviewId}`);
      return res.redirect(`/product/${req.params.id}`);
    }
    console.log(`Edit review: Rendering edit form for review ${req.params.reviewId}`);
    res.render("product", {
      product,
      users: db.users || [],
      user: req.user,
      categories: db.categories || [],
      editReview: review,
      query: req.query || {},
    });
  } catch (err) {
    console.error("Error in edit review form route:", {
      error: err.message,
      stack: err.stack,
      productId: req.params.id,
      reviewId: req.params.reviewId,
    });
    next(err);
  }
});

// Edit Review
router.post("/:id/review/edit", (req, res, next) => {
  try {
    if (!req.user) return res.redirect("/auth/login");
    const db = loadDB();
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product) {
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
        query: req.query || {},
      });
    }

    const { reviewId, rating, comment } = req.body;
    const review = product.reviews.find((r) => r.id === reviewId);
    if (!review || review.userId !== req.user.id) {
      console.warn(`Edit review: Review ${reviewId} not found or user ${req.user.id} not authorized`);
      return res.redirect(`/product/${req.params.id}`);
    }

    if (!rating || rating < 1 || rating > 5 || !comment) {
      return res.render("product", {
        product,
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        editReview: review,
        error: "Please provide a valid rating (1-5) and comment.",
        query: req.query || {},
      });
    }

    review.rating = parseInt(rating);
    review.comment = comment;
    review.edited = true;
    review.timestamp = new Date().toISOString();

    saveDB(db);
    res.redirect(`/product/${req.params.id}`);
  } catch (err) {
    console.error("Error in edit review route:", {
      error: err.message,
      stack: err.stack,
      productId: req.params.id,
      reviewId: req.body.reviewId,
    });
    next(err);
  }
});

// Delete Review
router.post("/:id/review/delete", (req, res, next) => {
  try {
    if (!req.user) return res.redirect("/auth/login");
    const db = loadDB();
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product) {
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
        query: req.query || {},
      });
    }
    const { reviewId } = req.body;
    let reviewIndex = -1;
    let review = null;

    // Try finding review by id
    if (reviewId) {
      review = product.reviews.find((r) => r.id === reviewId);
      reviewIndex = product.reviews.findIndex((r) => r.id === reviewId);
    }
    // Fallback: find by userId if no id
    if (!review && !reviewId) {
      review = product.reviews.find((r) => r.userId === req.user.id);
      reviewIndex = product.reviews.findIndex((r) => r.userId === req.user.id);
    }

    if (!review || review.userId !== req.user.id) {
      console.warn("Review not found or user not authorized", { reviewId, userId: req.user.id });
      return res.redirect(`/product/${req.params.id}`);
    }

    product.reviews.splice(reviewIndex, 1);
    saveDB(db);
    res.redirect(`/product/${req.params.id}`);
  } catch (err) {
    console.error("Error in delete review route:", {
      error: err.message,
      stack: err.stack,
      productId: req.params.id,
      reviewId: req.body.reviewId,
    });
    next(err);
  }
});

module.exports = router;