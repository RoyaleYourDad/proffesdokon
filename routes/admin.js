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

// Middleware to check admin
router.use((req, res, next) => {
  if (!req.user) {
    console.log("Admin middleware: No user, redirecting to /auth/login");
    return res.redirect("/auth/login");
  }
  if (!req.user.isAdmin) {
    console.log(
      `Admin middleware: User ${req.user.email} is not admin, redirecting to /`
    );
    return res.redirect("/");
  }
  console.log(`Admin middleware: User ${req.user.email} is admin, proceeding`);
  next();
});

// Admin Dashboard
router.get("/", (req, res) => {
  const db = loadDB();
  res.render("admin/index", {
    products: db.products || [],
    user: req.user,
    categories: db.categories || [],
  });
});

// Add Product Page
router.get("/add", (req, res) => {
  const db = loadDB();
  res.render("admin/edit", {
    product: null,
    categories: db.categories || [],
    user: req.user,
  });
});

// Alias for /admin/add
router.get("/create", (req, res) => {
  console.log(`Accessing /admin/create for user ${req.user.email}`);
  res.redirect("/admin/add");
});

// Add Product
router.post("/add", (req, res) => {
  req.upload(req, res, async (err) => {
    if (err) return res.status(400).send("Upload error");
    const db = loadDB();
    const { name, category, price, discountPrice, discountExpiry, origin } =
      req.body;
    const details = req.body.details
      ? req.body.details.key
          .map((key, i) => ({
            key,
            value: req.body.details.value[i],
          }))
          .filter((d) => d.key && d.value)
      : [];

    const product = {
      id: Date.now().toString(),
      name,
      category,
      price: parseFloat(price),
      discountPrice: discountPrice ? parseFloat(discountPrice) : null,
      discountExpiry: discountExpiry || null,
      origin: origin || null,
      details,
      reviews: [],
    };

    if (req.files.thumbnail && req.files.thumbnail[0]) {
      try {
        const uploaded = await req.app.locals.uploadToImgBB(
          req.files.thumbnail[0]
        );
        product.thumbnail = uploaded;
      } catch (err) {
        console.error("Thumbnail upload failed:", err);
      }
    }

    if (req.files.previewImages) {
      product.previewImages = [];
      for (const file of req.files.previewImages) {
        try {
          const uploaded = await req.app.locals.uploadToImgBB(file);
          product.previewImages.push(uploaded);
        } catch (err) {
          console.error("Preview image upload failed:", err);
        }
      }
    }

    db.products = db.products || [];
    db.products.push(product);
    saveDB(db);
    res.redirect("/admin");
  });
});

// Edit Product Page
router.get("/edit/:id", (req, res) => {
  const db = loadDB();
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.redirect("/admin");
  res.render("admin/edit", {
    product,
    categories: db.categories || [],
    user: req.user,
  });
});

// Update Product
router.post("/edit/:id", (req, res) => {
  req.upload(req, res, async (err) => {
    if (err) return res.status(400).send("Upload error");
    const db = loadDB();
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product) return res.redirect("/admin");

    const { name, category, price, discountPrice, discountExpiry, origin } =
      req.body;
    const details = req.body.details
      ? req.body.details.key
          .map((key, i) => ({
            key,
            value: req.body.details.value[i],
          }))
          .filter((d) => d.key && d.value)
      : [];

    product.name = name;
    product.category = category;
    product.price = parseFloat(price);
    product.discountPrice = discountPrice ? parseFloat(discountPrice) : null;
    product.discountExpiry = discountExpiry || null;
    product.origin = origin || null;
    product.details = details;

    if (req.files.thumbnail && req.files.thumbnail[0]) {
      try {
        if (product.thumbnail?.delete_url) {
          await req.app.locals.deleteFromImgBB(product.thumbnail.delete_url);
        }
        const uploaded = await req.app.locals.uploadToImgBB(
          req.files.thumbnail[0]
        );
        product.thumbnail = uploaded;
      } catch (err) {
        console.error("Thumbnail upload/delete failed:", err);
      }
    }

    if (req.files.previewImages) {
      try {
        if (product.previewImages) {
          for (const img of product.previewImages) {
            if (img.delete_url) {
              await req.app.locals.deleteFromImgBB(img.delete_url);
            }
          }
        }
        product.previewImages = [];
        for (const file of req.files.previewImages) {
          const uploaded = await req.app.locals.uploadToImgBB(file);
          product.previewImages.push(uploaded);
        }
      } catch (err) {
        console.error("Preview images upload/delete failed:", err);
      }
    }

    saveDB(db);
    res.redirect("/admin");
  });
});

// Delete Product
router.post("/delete/:id", async (req, res) => {
  const db = loadDB();
  const product = db.products.find((p) => p.id === req.params.id);
  if (!product) return res.redirect("/admin");

  try {
    if (product.thumbnail?.delete_url) {
      await req.app.locals.deleteFromImgBB(product.thumbnail.delete_url);
    }
    if (product.previewImages) {
      for (const img of product.previewImages) {
        if (img.delete_url) {
          await req.app.locals.deleteFromImgBB(img.delete_url);
        }
      }
    }
    db.products = db.products.filter((p) => p.id !== req.params.id);
    saveDB(db);
  } catch (err) {
    console.error("Error deleting images:", err);
  }
  res.redirect("/admin");
});

// Delete Image
router.post("/image/delete", async (req, res) => {
  const { delete_url } = req.body;
  try {
    const success = await req.app.locals.deleteFromImgBB(delete_url);
    if (success) {
      const db = loadDB();
      db.products.forEach((product) => {
        if (product.thumbnail?.delete_url === delete_url) {
          product.thumbnail = null;
        }
        if (product.previewImages) {
          product.previewImages = product.previewImages.filter(
            (img) => img.delete_url !== delete_url
          );
        }
      });
      saveDB(db);
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false });
    }
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Add Category
router.post("/category/add", (req, res) => {
  const db = loadDB();
  const { name } = req.body;
  if (name && !db.categories.includes(name)) {
    db.categories.push(name);
    saveDB(db);
    res.json({ success: true });
  } else {
    res
      .status(400)
      .json({ success: false, error: "Invalid or duplicate category" });
  }
});

// User Management
router.get("/users", (req, res) => {
  const db = loadDB();
  res.render("admin/users", {
    users: db.users || [],
    user: req.user,
    categories: db.categories || [],
  });
});

router.post("/users/:id/role", (req, res) => {
  const db = loadDB();
  const targetUser = db.users.find((u) => u.id === req.params.id);
  if (targetUser) {
    targetUser.role = req.body.role;
    targetUser.isAdmin = targetUser.role === "admin";
    saveDB(db);
  }
  res.redirect("/admin/users");
});

module.exports = router;
