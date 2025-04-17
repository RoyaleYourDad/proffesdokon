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
  try {
    const db = loadDB();
    let products = db.products || [];
    const query = req.query;

    console.log("Query parameters:", query);

    // Compute used categories
    const usedCategories = [...new Set(products.map(p => p.category).filter(Boolean))];
    console.log("Used categories:", usedCategories);

    // Search filter
    if (query.search) {
      const searchTerm = query.search.toLowerCase().trim();
      products = products.filter((p) =>
        (p.name && p.name.toLowerCase().includes(searchTerm)) ||
        (p.category && p.category.toLowerCase().includes(searchTerm)) ||
        (p.origin && p.origin.toLowerCase().includes(searchTerm)) ||
        (p.details && p.details.some(d =>
          (d.key && d.key.toLowerCase().includes(searchTerm)) ||
          (d.value && d.value.toLowerCase().includes(searchTerm))
        ))
      );
      console.log(`Search term: ${searchTerm}, matched products: ${products.length}`);
    }

    // Category filter (support multiple categories)
    if (query.category) {
      const categories = Array.isArray(query.category) ? query.category : [query.category];
      console.log("Selected categories:", categories);
      if (categories.length > 0 && !categories.includes("")) {
        products = products.filter((p) => {
          if (!p.category) {
            console.warn(`Product ${p.name} has no category`);
            return false;
          }
          return categories.some((c) => p.category.toLowerCase().trim() === c.toLowerCase().trim());
        });
      }
    }

    // Price range filter
    if (query.priceMin || query.priceMax) {
      const priceMin = parseFloat(query.priceMin) || 0;
      const priceMax = parseFloat(query.priceMax) || Infinity;
      console.log(`Price range: ${priceMin} - ${priceMax}`);
      products = products.filter((p) => {
        const effectivePrice =
          p.discountPrice &&
            (!p.discountExpiry || new Date(p.discountExpiry) > new Date())
            ? p.discountPrice
            : p.price;
        return effectivePrice >= priceMin && effectivePrice <= priceMax;
      });
    }

    // Sort filter
    if (query.sort) {
      console.log("Sort option:", query.sort);
      if (query.sort === "price-asc") {
        products.sort((a, b) => {
          const priceA =
            a.discountPrice &&
              (!a.discountExpiry || new Date(a.discountExpiry) > new Date())
              ? a.discountPrice
              : a.price;
          const priceB =
            b.discountPrice &&
              (!b.discountExpiry || new Date(b.discountExpiry) > new Date())
              ? b.discountPrice
              : b.price;
          return priceA - priceB;
        });
      } else if (query.sort === "price-desc") {
        products.sort((a, b) => {
          const priceA =
            a.discountPrice &&
              (!a.discountExpiry || new Date(a.discountExpiry) > new Date())
              ? a.discountPrice
              : a.price;
          const priceB =
            b.discountPrice &&
              (!b.discountExpiry || new Date(b.discountExpiry) > new Date())
              ? b.discountPrice
              : b.price;
          return priceB - priceA;
        });
      } else if (query.sort === "name-asc") {
        products.sort((a, b) => a.name.localeCompare(b.name));
      } else if (query.sort === "rating-desc") {
        products.sort((a, b) => {
          const ratingA =
            a.reviews && a.reviews.length > 0
              ? a.reviews.reduce((sum, r) => sum + r.rating, 0) / a.reviews.length
              : 0;
          const ratingB =
            b.reviews && b.reviews.length > 0
              ? b.reviews.reduce((sum, r) => sum + r.rating, 0) / b.reviews.length
              : 0;
          return ratingB - ratingA;
        });
      }
    }

    console.log("Filtered products count:", products.length);

    res.render("index", {
      products,
      categories: usedCategories,
      query,
      user: req.user,
      error:
        products.length === 0 && (query.search || query.category || query.priceMin || query.priceMax)
          ? "No products match your filters. Try different categories (e.g., Grillar, Gaz Plitalari, Tosterlar) or clear filters."
          : null,
    });
  } catch (err) {
    console.error("Error loading products:", err);
    res.status(500).render("error", {
      message: "Failed to load products",
      user: req.user,
      query: req.query || {}, // Ensure query is passed
    });
  }
});

// GET /product/:id
router.get("/product/:id", (req, res) => {
  const db = loadDB();
  const product = db.products.find((p) => p.id === req.params.id);

  if (!product) {
    return res.status(404).render("index", {
      products: [],
      categories: [...new Set(db.products.map(p => p.category).filter(Boolean))],
      query: req.query || {},
      user: req.user,
      error: "Product not found",
    });
  }

  res.render("product", {
    product,
    users: db.users || [],
    user: req.user,
    query: req.query || {},
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
      users: db.users || [],
      user: req.user,
      query: req.query || {},
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

module.exports = router;