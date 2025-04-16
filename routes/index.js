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

const saveDB = (data) => {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving database:", err);
  }
};

// GET /
router.get("/", (req, res) => {
  const db = loadDB();
  let products = db.products;
  const query = req.query;

  // Search filter
  if (query.search) {
    products = products.filter((p) =>
      p.name.toLowerCase().includes(query.search.toLowerCase())
    );
  }

  // Category filter
  if (query.category) {
    products = products.filter((p) => p.category === query.category);
  }

  // Price range filter
  if (query.priceMin || query.priceMax) {
    const priceMin = parseFloat(query.priceMin) || 0;
    const priceMax = parseFloat(query.priceMax) || Infinity;
    products = products.filter((p) => {
      const effectivePrice = p.discountPrice && new Date(p.discountExpiry) > new Date() ? p.discountPrice : p.price;
      return effectivePrice >= priceMin && effectivePrice <= priceMax;
    });
  }

  // Sort filter
  if (query.sort) {
    if (query.sort === "price-asc") {
      products.sort((a, b) => {
        const priceA = a.discountPrice && new Date(a.discountExpiry) > new Date() ? a.discountPrice : a.price;
        const priceB = b.discountPrice && new Date(b.discountExpiry) > new Date() ? b.discountPrice : b.price;
        return priceA - priceB;
      });
    } else if (query.sort === "price-desc") {
      products.sort((a, b) => {
        const priceA = a.discountPrice && new Date(a.discountExpiry) > new Date() ? a.discountPrice : a.price;
        const priceB = b.discountPrice && new Date(b.discountExpiry) > new Date() ? b.discountPrice : b.price;
        return priceB - priceA;
      });
    } else if (query.sort === "name-asc") {
      products.sort((a, b) => a.name.localeCompare(b.name));
    } else if (query.sort === "rating-desc") {
      products.sort((a, b) => {
        const ratingA = a.reviews && a.reviews.length > 0 ? a.reviews.reduce((sum, r) => sum + r.rating, 0) / a.reviews.length : 0;
        const ratingB = b.reviews && b.reviews.length > 0 ? b.reviews.reduce((sum, r) => sum + r.rating, 0) / b.reviews.length : 0;
        return ratingB - ratingA;
      });
    }
  }

  res.render("index", {
    products,
    categories: db.categories,
    query,
    user: req.user,
    error: null,
  });
});

// Sort filter
if (query.sort) {
  if (query.sort === "price-asc") {
    products.sort((a, b) => {
      const priceA = a.discountPrice && new Date(a.discountExpiry) > new Date() ? a.discountPrice : a.price;
      const priceB = b.discountPrice && new Date(b.discountExpiry) > new Date() ? b.discountPrice : b.price;
      return priceA - priceB;
    });
  } else if (query.sort === "price-desc") {
    products.sort((a, b) => {
      const priceA = a.discountPrice && new Date(a.discountExpiry) > new Date() ? a.discountPrice : a.price;
      const priceB = b.discountPrice && new Date(b.discountExpiry) > new Date() ? b.discountPrice : b.price;
      return priceB - priceA;
    });
  } else if (query.sort === "name-asc") {
    products.sort((a, b) => a.name.localeCompare(b.name));
  } else if (query.sort === "rating-desc") {
    products.sort((a, b) => {
      const ratingA = a.reviews && a.reviews.length > 0 ? a.reviews.reduce((sum, r) => sum + r.rating, 0) / a.reviews.length : 0;
      const ratingB = b.reviews && b.reviews.length > 0 ? b.reviews.reduce((sum, r) => sum + r.rating, 0) / b.reviews.length : 0;
      return ratingB - ratingA;
    });
  }
}

res.render("index", {
  products,
  categories: db.categories,
  query,
  user: req.user,
  error: null,
});

// GET /product/:id
router.get("/product/:id", (req, res) => {
  const db = loadDB();
  const product = db.products.find((p) => p.id === req.params.id);

  if (!product) {
    return res.status(404).render("index", {
      products: [],
      categories: db.categories,
      query: {},
      user: req.user,
      error: "Product not found",
    });
  }

  res.render("product", {
    product,
    users: db.users,
    user: req.user,
    error: null,
  });
});

// POST /product/:id/review
router.post("/product/:id/review", (req, res) => {
  if (!req.user) {
    return res.redirect("/auth/login");
  }

  const db = loadDB();
  const product = db.products.find((p) => p.id === req.params.id);

  if (!product) {
    return res.redirect("/");
  }

  const { rating, comment } = req.body;
  if (!rating || !comment) {
    return res.render("product", {
      product,
      users: db.users,
      user: req.user,
      error: "Rating and comment are required",
    });
  }

  product.reviews = product.reviews || [];
  product.reviews.push({
    userId: req.user.id,
    rating: parseInt(rating),
    comment,
    timestamp: new Date(),
  });

  saveDB(db);
  res.redirect(`/product/${req.params.id}`);
});

product.reviews = product.reviews || [];
product.reviews.push({
  userId: req.user.id,
  rating: parseInt(rating),
  comment,
  timestamp: new Date(),
});

saveDB(db);
res.redirect(`/product/${req.params.id}`);

module.exports = router;