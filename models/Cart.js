// routes/cart.js
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const dbPath = path.join(__dirname, "../database.json");

const loadDB = () => {
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  } catch (err) {
    console.error("Error loading database:", err);
    return { products: [], categories: [], users: [] };
  }
};

// POST /cart/add (expects productId in body)
router.post("/add", (req, res) => {
  try {
    const db = loadDB();
    const { productId, quantity = 1 } = req.body;
    const product = db.products.find((p) => p.id == productId);
    if (!product) {
      console.error(`Product ID ${productId} not found`);
      const categories = [
        ...new Set(db.products.map((p) => p.category).filter((c) => c)),
      ];
      return res.status(404).render("index", {
        products: db.products,
        categories,
        query: {},
        user: req.session.user || null,
        error: "Product not found",
      });
    }
    if (!req.session.user) {
      console.error("User not logged in");
      return res.redirect("/auth/login");
    }
    const user = db.users.find((u) => u.id === req.session.user.id);
    if (!user.cart) user.cart = [];
    const existingItem = user.cart.find((item) => item.productId == productId);
    if (existingItem) {
      existingItem.quantity += parseInt(quantity);
    } else {
      user.cart.push({ productId, quantity: parseInt(quantity) });
    }
    user.cartCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
    saveDB(db);
    res.redirect("/cart");
  } catch (err) {
    console.error("Cart add error:", err);
    const db = loadDB();
    const categories = [
      ...new Set(db.products.map((p) => p.category).filter((c) => c)),
    ];
    res.status(500).render("index", {
      products: db.products,
      categories,
      query: {},
      user: req.session.user || null,
      error: "Failed to add to cart",
    });
  }
});

// POST /cart/add/:productId (supports current index.ejs form)
router.post("/add/:productId", (req, res) => {
  try {
    const db = loadDB();
    const productId = req.params.productId;
    const quantity = req.body.quantity || 1;
    const product = db.products.find((p) => p.id == productId);
    if (!product) {
      console.error(`Product ID ${productId} not found`);
      const categories = [
        ...new Set(db.products.map((p) => p.category).filter((c) => c)),
      ];
      return res.status(404).render("index", {
        products: db.products,
        categories,
        query: {},
        user: req.session.user || null,
        error: "Product not found",
      });
    }
    if (!req.session.user) {
      console.error("User not logged in");
      return res.redirect("/auth/login");
    }
    const user = db.users.find((u) => u.id === req.session.user.id);
    if (!user.cart) user.cart = [];
    const existingItem = user.cart.find((item) => item.productId == productId);
    if (existingItem) {
      existingItem.quantity += parseInt(quantity);
    } else {
      user.cart.push({ productId, quantity: parseInt(quantity) });
    }
    user.cartCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
    saveDB(db);
    res.redirect("/cart");
  } catch (err) {
    console.error("Cart add error:", err);
    const db = loadDB();
    const categories = [
      ...new Set(db.products.map((p) => p.category).filter((c) => c)),
    ];
    res.status(500).render("index", {
      products: db.products,
      categories,
      query: {},
      user: req.session.user || null,
      error: "Failed to add to cart",
    });
  }
});

module.exports = router;
