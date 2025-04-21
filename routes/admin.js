const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const router = express.Router();
const ExcelJS = require("exceljs");
const { loadDB, saveDB } = require("../db");

// Middleware to check admin
router.use(async (req, res, next) => {
  if (!req.user) {
    console.log("Admin middleware: No user, redirecting to /auth/login", {
      sessionID: req.sessionID,
      path: req.path,
    });
    return res.redirect("/auth/login");
  }
  const db = await loadDB();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user || !user.isAdmin) {
    console.log(`Admin middleware: User ${req.user.email} is not admin, redirecting to /`, {
      userId: req.user.id,
      isAdmin: user ? user.isAdmin : "user not found",
    });
    return res.redirect("/");
  }
  console.log(`Admin middleware: User ${req.user.email} is admin, proceeding`);
  next();
});

// notifications
// Helper function to compute alerts and analytics
const computeAlertsAndAnalytics = (db) => {
  const now = new Date();
  const lowStockThreshold = 5;
  const discountExpiryDays = 7;

  // Alerts
  const lowStockProducts = db.products.filter(p => p.stock > 0 && p.stock <= lowStockThreshold);
  const uncategorizedProducts = db.products.filter(p => !p.category);
  const expiringDiscounts = db.products.filter(p => 
    p.discountExpiry && 
    new Date(p.discountExpiry) > now && 
    (new Date(p.discountExpiry) - now) / (1000 * 60 * 60 * 24) <= discountExpiryDays
  );
  const pendingReviews = db.products
    .flatMap(p => (p.reviews || []).map(r => ({ ...r, productId: p.id, productName: p.name })))
    .filter(r => !r.moderated); // Assume reviews have a `moderated` field; add if needed

  const alerts = [
    ...lowStockProducts.map(p => ({
      type: "low_stock",
      message: `Product "${p.name}" has low stock (${p.stock} units)`,
      link: `/admin/edit/${p.id}`,
      timestamp: now,
    })),
    ...uncategorizedProducts.map(p => ({
      type: "uncategorized",
      message: `Product "${p.name}" has no category`,
      link: `/admin/edit/${p.id}`,
      timestamp: now,
    })),
    ...expiringDiscounts.map(p => ({
      type: "expiring_discount",
      message: `Discount for "${p.name}" expires on ${new Date(p.discountExpiry).toLocaleDateString()}`,
      link: `/admin/edit/${p.id}`,
      timestamp: now,
    })),
    ...pendingReviews.map(r => ({
      type: "pending_review",
      message: `New review for "${r.productName}" needs moderation`,
      link: `/admin/edit/${r.productId}#reviews`,
      timestamp: now,
    })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // Analytics
  const last30Days = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const sales = db.products
    .flatMap(p => (p.sales || []).filter(s => new Date(s.date) >= last30Days))
    .reduce((acc, s) => acc + (s.quantity * s.price), 0);

  const topSellingProducts = db.products
    .map(p => ({
      name: p.name,
      sales: (p.sales || []).reduce((acc, s) => acc + s.quantity, 0),
    }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 5);

  const stockTurnover = db.products
    .map(p => ({
      name: p.name,
      turnover: (p.sales || []).reduce((acc, s) => acc + s.quantity, 0) / (p.stock + (p.sales || []).reduce((acc, s) => acc + s.quantity, 0)) || 0,
    }))
    .sort((a, b) => b.turnover - a.turnover);

  return {
    alerts,
    analytics: {
      revenueLast30Days: sales.toFixed(2),
      topSellingProducts,
      stockTurnover,
    },
  };
};



// Admin Dashboard
router.get("/", async (req, res) => {
  try {
    // Reload database to ensure fresh data
    const db = await loadDB();
    if (!db.users || !db.products) {
      throw new Error("Invalid database structure");
    }

    const { alerts, analytics } = computeAlertsAndAnalytics(db);

    // Ensure user exists and has notifications array
    const user = db.users.find(u => u.id === req.user.id);
    if (!user) {
      console.error("User not found in DB:", { userId: req.user.id, email: req.user.email });
      return res.status(401).render("error", {
        message: "User not found",
        user: req.user,
        query: req.query || {},
      });
    }
    if (!user.notifications) {
      user.notifications = [];
    }

    // Add new alerts to notifications
    alerts.forEach(alert => {
      if (!user.notifications.some(n => n.message === alert.message && n.link === alert.link)) {
        user.notifications.push({ ...alert, read: false });
      }
    });

    // Save database and verify
    try {
      await saveDB(db);
      console.log("Notifications saved for user:", {
        userId: req.user.id,
        email: req.user.email,
        notificationCount: user.notifications.length,
      });
    } catch (saveErr) {
      console.error("Failed to save notifications to DB:", saveErr);
      return res.status(500).render("error", {
        message: "Failed to save notifications",
        user: req.user,
        query: req.query || {},
      });
    }

    console.log("Rendering admin/index with:", {
      userId: req.user.id,
      productCount: db.products.length,
      alertCount: alerts.length,
      notificationCount: user.notifications.length,
      analytics,
    });

    res.render("admin/index", {
      products: db.products || [],
      user: req.user,
      categories: db.categories || [],
      users: db.users || [],
      alerts,
      analytics,
      notifications: user.notifications,
    });
  } catch (err) {
    console.error("Error rendering admin dashboard:", err);
    res.status(500).render("error", {
      message: "Failed to load admin dashboard",
      user: req.user,
      query: req.query || {},
    });
  }
});

// Mark notification as read
router.post("/notification/read/:index", async (req, res) => {
  try {
    // Reload database to ensure fresh data
    const db = await loadDB();
    if (!db.users) {
      throw new Error("Invalid database structure");
    }

    const user = db.users.find(u => u.id === req.user.id);
    if (!user) {
      console.error("User not found in DB:", { userId: req.user.id, email: req.user.email });
      return res.status(401).render("error", {
        message: "User not found",
        user: req.user,
        query: req.query || {},
      });
    }

    const index = parseInt(req.params.index);
    if (!user.notifications || !user.notifications[index]) {
      console.warn("Notification not found:", { userId: req.user.id, index });
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    user.notifications[index].read = true;

    // Save database and verify
    try {
      await saveDB(db);
      console.log("Notification marked as read:", {
        userId: req.user.id,
        email: req.user.email,
        index,
        message: user.notifications[index].message,
      });
    } catch (saveErr) {
      console.error("Failed to save notification read status:", saveErr);
      return res.status(500).json({ success: false, message: "Failed to save notification status" });
    }

    res.redirect("/admin");
  } catch (err) {
    console.error("Error marking notification as read:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Add Product Page
router.get("/add", async (req, res) => {
  try {
    const db = await loadDB();
    res.render("admin/edit", {
      product: null,
      categories: db.categories || [],
      user: req.user,
      error: null,
    });
  } catch (err) {
    console.error("Error rendering add product page:", err);
    res.status(500).render("error", {
      message: "Failed to load add product page",
      user: req.user,
      query: req.query || {},
    });
  }
});

// Alias for /admin/add
router.get("/create", (req, res) => {
  console.log(`Accessing /admin/create for user ${req.user.email}`);
  res.redirect("/admin/add");
});

// Add Product
router.post("/add", (req, res) => {
  req.upload(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      try {
        const db = await loadDB();
        return res.render("admin/edit", {
          product: null,
          categories: db.categories || [],
          user: req.user,
          error: err.message,
        });
      } catch (dbErr) {
        console.error("Error loading db for upload error:", dbErr);
        return res.status(500).render("error", {
          message: "Failed to load add product page",
          user: req.user,
          query: req.query || {},
        });
      }
    }
    try {
      const db = await loadDB();
      const { name, category, price, stock, discountPrice, discountExpiry, origin } = req.body;
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
        stock: parseInt(stock) || 0,
        discountPrice: discountPrice ? parseFloat(discountPrice) : null,
        discountExpiry: discountExpiry || null,
        origin: origin || null,
        details,
        reviews: [],
      };

      if (req.files.thumbnail && req.files.thumbnail[0]) {
        const uploaded = await req.app.locals.uploadToImgBB(req.files.thumbnail[0]);
        product.thumbnail = uploaded;
      }

      if (req.files.previewImages) {
        product.previewImages = [];
        for (const file of req.files.previewImages.slice(0, 8)) {
          const uploaded = await req.app.locals.uploadToImgBB(file);
          product.previewImages.push(uploaded);
        }
      }

      db.products = db.products || [];
      db.products.push(product);
      if (category && !db.categories.includes(category)) {
        db.categories.push(category);
      }
      await saveDB(db);
      console.log("Product added:", product.id);
      res.redirect("/admin");
    } catch (err) {
      console.error("Add product error:", err);
      try {
        const db = await loadDB();
        res.render("admin/edit", {
          product: null,
          categories: db.categories || [],
          user: req.user,
          error: "Failed to add product",
        });
      } catch (dbErr) {
        console.error("Error loading db for add product error:", dbErr);
        res.status(500).render("error", {
          message: "Failed to load add product page",
          user: req.user,
          query: req.query || {},
        });
      }
    }
  });
});

// Edit Product Page
router.get("/edit/:id", async (req, res) => {
  try {
    const db = await loadDB();
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product) {
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
      });
    }
    res.render("admin/edit", {
      product,
      categories: db.categories || [],
      users: db.users || [],
      user: req.user,
      error: null,
    });
  } catch (err) {
    console.error("Error rendering edit product page:", err);
    res.status(500).render("error", {
      message: "Failed to load edit product page",
      user: req.user,
      query: req.query || {},
    });
  }
});

// Update Product
router.post("/edit/:id", (req, res) => {
  req.upload(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      try {
        const db = await loadDB();
        const product = db.products.find((p) => p.id === req.params.id);
        return res.render("admin/edit", {
          product,
          categories: db.categories || [],
          users: db.users || [],
          user: req.user,
          error: err.message,
        });
      } catch (dbErr) {
        console.error("Error loading db for upload error:", dbErr);
        return res.status(500).render("error", {
          message: "Failed to load edit product page",
          user: req.user,
          query: req.query || {},
        });
      }
    }
    try {
      const db = await loadDB();
      const product = db.products.find((p) => p.id === req.params.id);
      if (!product) {
        return res.status(404).render("error", {
          message: "Product not found",
          user: req.user,
        });
      }

      const { name, category, price, stock, discountPrice, discountExpiry, origin, deleteImages } = req.body;
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
      product.stock = parseInt(stock) || 0;
      product.discountPrice = discountPrice ? parseFloat(discountPrice) : null;
      product.discountExpiry = discountExpiry || null;
      product.origin = origin || null;
      product.details = details;

      if (req.files.thumbnail && req.files.thumbnail[0]) {
        if (product.thumbnail?.delete_url) {
          await req.app.locals.deleteFromImgBB(product.thumbnail.delete_url);
        }
        const uploaded = await req.app.locals.uploadToImgBB(req.files.thumbnail[0]);
        product.thumbnail = uploaded;
      }

      if (req.files.previewImages) {
        product.previewImages = product.previewImages || [];
        for (const file of req.files.previewImages.slice(0, 8 - product.previewImages.length)) {
          const uploaded = await req.app.locals.uploadToImgBB(file);
          product.previewImages.push(uploaded);
        }
      }

      if (deleteImages) {
        const imagesToDelete = Array.isArray(deleteImages) ? deleteImages : [deleteImages];
        for (const url of imagesToDelete) {
          const index = product.previewImages.findIndex((img) => img.url === url);
          if (index !== -1) {
            await req.app.locals.deleteFromImgBB(product.previewImages[index].delete_url);
            product.previewImages.splice(index, 1);
          }
        }
      }

      if (category && !db.categories.includes(category)) {
        db.categories.push(category);
      }
      await saveDB(db);
      console.log("Product edited:", product.id);
      res.redirect("/admin");
    } catch (err) {
      console.error("Edit product error:", err);
      try {
        const db = await loadDB();
        const product = db.products.find((p) => p.id === req.params.id);
        res.render("admin/edit", {
          product,
          categories: db.categories || [],
          users: db.users || [],
          user: req.user,
          error: "Failed to edit product",
        });
      } catch (dbErr) {
        console.error("Error loading db for edit product error:", dbErr);
        res.status(500).render("error", {
          message: "Failed to load edit product page",
          user: req.user,
          query: req.query || {},
        });
      }
    }
  });
});

// Delete Product
router.post("/delete/:id", async (req, res) => {
  try {
    const db = await loadDB();
    const product = db.products.find((p) => p.id === req.params.id);
    if (!product) {
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
      });
    }

    if (product.thumbnail?.delete_url) {
      await req.app.locals.deleteFromImgBB(product.thumbnail.delete_url);
    }
    if (product.previewImages) {
      for (const img of product.previewImages) {
        await req.app.locals.deleteFromImgBB(img.delete_url);
      }
    }
    db.products = db.products.filter((p) => p.id !== req.params.id);
    await saveDB(db);
    console.log("Product deleted:", req.params.id);
    res.redirect("/admin");
  } catch (err) {
    console.error("Delete product error:", err);
    res.status(500).render("error", {
      message: "Failed to delete product",
      user: req.user,
    });
  }
});

// Delete Image
router.post("/image/delete", async (req, res) => {
  const { delete_url } = req.body;
  try {
    const success = await req.app.locals.deleteFromImgBB(delete_url);
    if (success) {
      const db = await loadDB();
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
      await saveDB(db);
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false });
    }
  } catch (err) {
    console.error("Image deletion error:", err);
    res.status(500).json({ success: false });
  }
});

// Add Category
// Add Category
router.post("/category/add", async (req, res) => {
  try {
    const db = await loadDB();
    const { name } = req.body;
    if (!name || name.trim() === "") {
      return res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "Category name cannot be empty",
        success: null,
      });
    }
    const normalizedName = name.trim().toLowerCase();
    if (db.categories.some(category => category.toLowerCase() === normalizedName)) {
      return res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "Category already exists",
        success: null,
      });
    }
    db.categories.push(name.trim());
    await saveDB(db);
    console.log("Category added:", name);
    res.render("admin/categories", {
      categories: db.categories || [],
      user: req.user,
      error: null,
      success: `Category "${name}" added successfully`,
    });
  } catch (err) {
    console.error("Add category error:", err);
    // ... (rest of the error handling remains the same)
  }
});

// User Management
router.get("/users", async (req, res) => {
  try {
    const db = await loadDB();
    res.render("admin/users", {
      users: db.users || [],
      user: req.user,
      categories: db.categories || [],
    });
  } catch (err) {
    console.error("Error rendering users page:", err);
    res.status(500).render("error", {
      message: "Failed to load users page",
      user: req.user,
      query: req.query || {},
    });
  }
});

router.post("/users/:id/role", async (req, res) => {
  try {
    const db = await loadDB();
    const targetUser = db.users.find((u) => u.id === req.params.id);
    if (targetUser) {
      targetUser.role = req.body.role;
      targetUser.isAdmin = targetUser.role === "admin";
      if (req.user.id === targetUser.id) {
        req.session.passport.user = targetUser; // Update session
      }
      await saveDB(db);
    }
    res.redirect("/admin/users");
  } catch (err) {
    console.error("Error updating user role:", err);
    res.status(500).render("error", {
      message: "Failed to update user role",
      user: req.user,
      query: req.query || {},
    });
  }
});

// Stock Management
router.get("/stock", async (req, res) => {
  try {
    const db = await loadDB();
    res.render("admin/stock", {
      products: db.products || [],
      user: req.user,
      categories: db.categories || [],
    });
  } catch (err) {
    console.error("Error rendering stock page:", err);
    res.status(500).render("error", {
      message: "Failed to load stock page",
      user: req.user,
      query: req.query || {},
    });
  }
});

router.post("/stock/update", async (req, res) => {
  try {
    const db = await loadDB();
    const { productId, action, quantity, notes, date } = req.body;
    console.log("Stock update request:", { productId, action, quantity, notes, date, userId: req.user.id });

    const product = db.products.find((p) => p.id === productId);
    if (!product) {
      console.log("Product not found:", productId);
      return res.render("admin/stock", {
        products: db.products,
        user: req.user,
        categories: db.categories || [],
        error: "Product not found",
      });
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      console.log("Invalid quantity:", quantity);
      return res.render("admin/stock", {
        products: db.products,
        user: req.user,
        categories: db.categories || [],
        error: "Invalid quantity",
      });
    }

    if (action === "sold" && qty > product.stock) {
      console.log("Insufficient stock:", { qty, stock: product.stock });
      return res.render("admin/stock", {
        products: db.products,
        user: req.user,
        categories: db.categories || [],
        error: `Cannot sell ${qty}. Available stock: ${product.stock}`,
      });
    }

    // Determine sale price
    let salePrice = product.price;
    if (
      product.discountPrice &&
      product.discountPrice <= product.price &&
      product.discountExpiry &&
      new Date(product.discountExpiry) > new Date()
    ) {
      salePrice = product.discountPrice;
    }

    if (action === "sold" && !salePrice) {
      console.log("No valid price for sale:", productId);
      return res.render("admin/stock", {
        products: db.products,
        user: req.user,
        categories: db.categories || [],
        error: "Product has no valid price for sale",
      });
    }

    // Generate stockHistory entry ID
    const historyId = Date.now().toString();

    // Update product stock and sales
    product.stock = action === "sold" ? product.stock - qty : product.stock + qty;
    if (action === "sold") {
      if (!product.sales) product.sales = [];
      product.sales.push({
        quantity: qty,
        price: salePrice,
        date: date || new Date().toISOString(),
        historyId: historyId, // Link to stockHistory
      });
    }

    // Add to stockHistory
    db.stockHistory = db.stockHistory || [];
    const historyEntry = {
      id: historyId,
      productId,
      action,
      quantity: qty,
      notes: notes || "",
      updatedBy: req.user.id,
      updatedAt: new Date().toISOString(),
      date: date || new Date().toISOString(),
    };
    db.stockHistory.push(historyEntry);

    await saveDB(db);
    console.log("Stock updated:", { productId, action, quantity: qty, salePrice: action === "sold" ? salePrice : null, userId: req.user.id });

    res.render("admin/stock", {
      products: db.products,
      user: req.user,
      categories: db.categories || [],
      success: `Stock updated: ${action === "sold" ? "Sold" : "Added"} ${qty} of ${product.name}`,
    });
  } catch (err) {
    console.error("Stock update error:", err);
    try {
      const db = await loadDB();
      res.render("admin/stock", {
        products: db.products || [],
        user: req.user,
        categories: db.categories || [],
        error: "Failed to update stock: Server error",
      });
    } catch (dbErr) {
      console.error("Error loading db for stock update error:", dbErr);
      res.status(500).render("error", {
        message: "Failed to load stock page",
        user: req.user,
        query: req.query || {},
      });
    }
  }
});

// Stock History
router.get("/stock/history", async (req, res) => {
  try {
    const db = await loadDB();
    let { dateRange, startDate, endDate, productId, action } = req.query;

    // Normalize and sort stockHistory (oldest first for stockAfter calculation)
    let history = (db.stockHistory || []).map((entry) => ({
      id: entry.id || Date.now().toString(),
      productId: entry.productId || "",
      action: entry.action || "unknown",
      quantity: parseInt(entry.quantity) || 0,
      notes: entry.notes || "",
      updatedBy: entry.updatedBy || "",
      updatedAt: entry.updatedAt || new Date().toISOString(),
      date: entry.date || entry.updatedAt || new Date().toISOString(),
    })).sort((a, b) => new Date(a.date || a.updatedAt) - new Date(b.date || b.updatedAt));

    // Log raw history for debugging
    console.log("Raw stock history:", history.map(h => ({
      id: h.id,
      productId: h.productId,
      action: h.action,
      quantity: h.quantity,
      date: h.date,
    })));

    // Calculate stockAfter for each entry
    history = history.map((entry, index) => {
      const product = db.products.find((p) => p.id === entry.productId);
      if (!product) {
        console.log(`Product not found for history entry ${entry.id}:`, {
          productId: entry.productId,
          entryDate: entry.date,
          entryAction: entry.action,
          entryQuantity: entry.quantity,
        });
        return { ...entry, stockAfter: null };
      }

      // Start with current stock
      let stockAfter = Number(product.stock) || 0;

      // Adjust for all subsequent entries (newer entries with higher indices)
      for (let i = index + 1; i < history.length; i++) {
        const laterEntry = history[i];
        if (laterEntry.productId === entry.productId) {
          const qty = Number(laterEntry.quantity) || 0;
          stockAfter += laterEntry.action === "sold" ? qty : -qty;
        }
      }

      // Log calculation details
      console.log(`Calculated stockAfter for entry ${entry.id}:`, {
        productId: entry.productId,
        productName: product.name,
        currentStock: product.stock,
        stockAfter,
        entryDate: entry.date,
        entryAction: entry.action,
        entryQuantity: entry.quantity,
      });

      // Ensure stockAfter is non-negative
      stockAfter = Number.isNaN(stockAfter) || stockAfter < 0 ? 0 : stockAfter;

      return { ...entry, stockAfter };
    });

    // Sort history newest first for display
    history = history.sort((a, b) => new Date(b.date || b.updatedAt) - new Date(a.date || a.updatedAt));

    // Log final history for rendering
    console.log("Final history for rendering:", history.map(h => ({
      id: h.id,
      productId: h.productId,
      productName: db.products.find(p => p.id === h.productId)?.name || "Unknown",
      action: h.action,
      quantity: h.quantity,
      stockAfter: h.stockAfter,
      date: h.date,
    })));

    // Apply filters
    let filteredHistory = history;
    if (!dateRange || dateRange === "allTime") dateRange = "allTime";
    if (dateRange !== "allTime") {
      const now = new Date();
      let fromDate;
      if (dateRange === "lastDay") {
        fromDate = new Date(now.setDate(now.getDate() - 1));
      } else if (dateRange === "lastWeek") {
        fromDate = new Date(now.setDate(now.getDate() - 7));
      } else if (dateRange === "lastMonth") {
        fromDate = new Date(now.setDate(now.getDate() - 30));
      } else if (dateRange === "custom" && startDate && endDate) {
        fromDate = new Date(startDate);
        const toDate = new Date(endDate);
        filteredHistory = filteredHistory.filter((entry) => {
          const entryDate = new Date(entry.date || entry.updatedAt);
          return entryDate >= fromDate && entryDate <= toDate;
        });
      }
      if (fromDate) {
        filteredHistory = filteredHistory.filter((entry) => new Date(entry.date || entry.updatedAt) >= fromDate);
      }
    }

    if (productId) {
      filteredHistory = filteredHistory.filter((entry) => entry.productId === productId);
    }

    if (action) {
      filteredHistory = filteredHistory.filter((entry) => entry.action === action);
    }

    console.log("Filtered history count:", filteredHistory.length);

    res.render("admin/stock-history", {
      history: filteredHistory,
      products: db.products || [],
      users: db.users || [],
      user: req.user,
      categories: db.categories || [],
      dateRange: dateRange || "allTime",
      startDate: startDate || "",
      endDate: endDate || "",
      productId: productId || "",
      action: action || "",
    });
  } catch (err) {
    console.error("Error rendering stock history:", err);
    res.status(500).render("error", {
      message: "Failed to load stock history",
      user: req.user,
      query: req.query || {},
    });
  }
});

// Stock History Export
router.get("/stock/history/export", async (req, res) => {
  try {
    const db = await loadDB();
    let { dateRange, startDate, endDate, productId, action } = req.query;

    // Normalize and sort stockHistory
    let history = (db.stockHistory || []).map((entry) => ({
      id: entry.id || Date.now().toString(),
      productId: entry.productId || "",
      action: entry.action || "unknown",
      quantity: parseInt(entry.quantity) || 0,
      notes: entry.notes || "",
      updatedBy: entry.updatedBy || "",
      updatedAt: entry.updatedAt || entry.timestamp || new Date().toISOString(),
      date: entry.date || entry.updatedAt || new Date().toISOString(),
    })).sort((a, b) => new Date(a.date || a.updatedAt) - new Date(b.date || b.updatedAt));

    // Calculate stockAfter
    history = history.map((entry, index) => {
      const product = db.products.find((p) => p.id === entry.productId);
      if (!product) return { ...entry, stockAfter: null };

      let stockAfter = product.stock;
      for (let i = index + 1; i < history.length; i++) {
        const laterEntry = history[i];
        if (laterEntry.productId === entry.productId) {
          stockAfter += laterEntry.action === "sold" ? laterEntry.quantity : -laterEntry.quantity;
        }
      }

      return { ...entry, stockAfter };
    });

    let filteredHistory = history;
    if (!dateRange || dateRange === "allTime") dateRange = "allTime";
    if (dateRange !== "allTime") {
      const now = new Date();
      let fromDate;
      if (dateRange === "lastDay") {
        fromDate = new Date(now.setDate(now.getDate() - 1));
      } else if (dateRange === "lastWeek") {
        fromDate = new Date(now.setDate(now.getDate() - 7));
      } else if (dateRange === "lastMonth") {
        fromDate = new Date(now.setDate(now.getDate() - 30));
      } else if (dateRange === "custom" && startDate && endDate) {
        fromDate = new Date(startDate);
        const toDate = new Date(endDate);
        filteredHistory = filteredHistory.filter((entry) => {
          const entryDate = new Date(entry.date || entry.updatedAt);
          return entryDate >= fromDate && entryDate <= toDate;
        });
      }
      if (fromDate) {
        filteredHistory = filteredHistory.filter((entry) => new Date(entry.date || entry.updatedAt) >= fromDate);
      }
    }

    if (productId) {
      filteredHistory = filteredHistory.filter((entry) => entry.productId === productId);
    }

    if (action) {
      filteredHistory = filteredHistory.filter((entry) => entry.action === action);
    }

    console.log("Export filtered history:", filteredHistory.length);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Stock History");
    worksheet.columns = [
      { header: "Date & Time", key: "date", width: 20 },
      { header: "Product", key: "productName", width: 20 },
      { header: "Action", key: "action", width: 10 },
      { header: "Quantity", key: "quantity", width: 10 },
      { header: "Stock", key: "stockAfter", width: 10 },
      { header: "Notes", key: "notes", width: 30 },
      { header: "Updated By", key: "updatedBy", width: 20 },
    ];

    filteredHistory.forEach((entry) => {
      const product = db.products.find((p) => p.id === entry.productId);
      const user = db.users.find((u) => u.id === entry.updatedBy);
      worksheet.addRow({
        date: new Date(entry.date || entry.updatedAt).toLocaleString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        productName: product ? product.name : "Unknown",
        action: entry.action,
        quantity: entry.action === "sold" ? -entry.quantity : entry.quantity,
        stockAfter: entry.stockAfter !== null ? entry.stockAfter : "N/A",
        notes: entry.notes || "-",
        updatedBy: user ? user.displayName : "Unknown",
      });
    });

    worksheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=stock_history.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Export error:", err);
    try {
      const db = await loadDB();
      res.status(500).render("admin/stock-history", {
        history: [],
        products: db.products || [],
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        dateRange: dateRange || "allTime",
        startDate: startDate || "",
        endDate: endDate || "",
        productId: productId || "",
        action: action || "",
        error: "Failed to export stock history",
      });
    } catch (dbErr) {
      console.error("Error loading db for export error:", dbErr);
      res.status(500).render("error", {
        message: "Failed to load stock history",
        user: req.user,
        query: req.query || {},
      });
    }
  }
});

// Edit Stock History Entry
router.post("/stock/history/edit", async (req, res) => {
  try {
    const db = await loadDB();
    const { id, productId, action, quantity, notes, date, dateRange, startDate, endDate, filterProductId, filterAction } = req.body;
    const qty = parseInt(quantity);

    // Validate inputs
    if (!id || !productId || !["sold", "bought"].includes(action) || isNaN(qty) || qty <= 0) {
      console.log("Invalid input:", { id, productId, action, quantity });
      return res.status(400).render("admin/stock-history", {
        history: db.stockHistory || [],
        products: db.products || [],
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        dateRange: dateRange || "allTime",
        startDate: startDate || "",
        endDate: endDate || "",
        productId: filterProductId || "",
        action: filterAction || "",
        error: "Invalid action or quantity",
      });
    }

    const entry = db.stockHistory.find((h) => h.id === id);
    if (!entry) {
      console.log("History entry not found:", id);
      return res.status(404).render("admin/stock-history", {
        history: db.stockHistory || [],
        products: db.products || [],
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        dateRange: dateRange || "allTime",
        startDate: startDate || "",
        endDate: endDate || "",
        productId: filterProductId || "",
        action: filterAction || "",
        error: "Stock history entry not found",
      });
    }

    // Reverse original stock change
    const originalProduct = db.products.find((p) => p.id === entry.productId);
    if (originalProduct) {
      if (entry.action === "sold") {
        originalProduct.stock += entry.quantity;
      } else if (entry.action === "bought") {
        originalProduct.stock -= entry.quantity;
        if (originalProduct.stock < 0) {
          originalProduct.stock = 0;
        }
      }
    }

    // Apply new stock change
    const newProduct = db.products.find((p) => p.id === productId);
    if (!newProduct) {
      console.log("Product not found:", productId);
      return res.status(404).render("admin/stock-history", {
        history: db.stockHistory || [],
        products: db.products || [],
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        dateRange: dateRange || "allTime",
        startDate: startDate || "",
        endDate: endDate || "",
        productId: filterProductId || "",
        action: filterAction || "",
        error: "Product not found",
      });
    }

    if (action === "sold") {
      if (newProduct.stock < qty) {
        console.log("Insufficient stock:", { qty, stock: newProduct.stock });
        return res.status(400).render("admin/stock-history", {
          history: db.stockHistory || [],
          products: db.products || [],
          users: db.users || [],
          user: req.user,
          categories: db.categories || [],
          dateRange: dateRange || "allTime",
          startDate: startDate || "",
          endDate: endDate || "",
          productId: filterProductId || "",
          action: filterAction || "",
          error: `Cannot sell ${qty} items. Only ${newProduct.stock} in stock.`,
        });
      }
      newProduct.stock -= qty;
    } else if (action === "bought") {
      newProduct.stock += qty;
    }

    // Update history entry
    entry.productId = productId;
    entry.action = action;
    entry.quantity = qty;
    entry.notes = notes || "";
    entry.updatedAt = new Date().toISOString();
    entry.updatedBy = req.user.id;
    entry.date = date || entry.date || new Date().toISOString();

    await saveDB(db);
    console.log("Stock history entry edited:", { id, productId, action, quantity: qty });

    // Redirect with preserved filters
    const query = new URLSearchParams({
      dateRange: dateRange || "allTime",
      startDate: startDate || "",
      endDate: endDate || "",
      productId: filterProductId || "",
      action: filterAction || "",
    }).toString();
    res.redirect(`/admin/stock/history${query ? "?" + query : ""}`);
  } catch (err) {
    console.error("Stock history edit error:", err);
    try {
      const db = await loadDB();
      res.status(500).render("admin/stock-history", {
        history: db.stockHistory || [],
        products: db.products || [],
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        dateRange: req.body.dateRange || "allTime",
        startDate: req.body.startDate || "",
        endDate: req.body.endDate || "",
        productId: req.body.filterProductId || "",
        action: req.body.filterAction || "",
        error: "Failed to edit stock history entry",
      });
    } catch (dbErr) {
      console.error("Error loading db for edit error:", dbErr);
      res.status(500).render("error", {
        message: "Failed to load stock history",
        user: req.user,
        query: req.query || {},
      });
    }
  }
});

// Delete Stock History Entry
router.post("/stock/history/delete", async (req, res) => {
  try {
    const db = await loadDB();
    const { id, action, quantity, productId, dateRange, startDate, endDate, filterProductId, filterAction } = req.body;

    const entry = db.stockHistory.find((h) => h.id === id);
    if (!entry) {
      console.log("History entry not found:", id);
      return res.redirect("/admin/stock/history");
    }

    const product = db.products.find((p) => p.id === productId);
    if (product) {
      if (action === "sold") {
        product.stock += parseInt(quantity);
        // Remove corresponding sales entry
        if (product.sales) {
          product.sales = product.sales.filter((s) => s.historyId !== id);
        }
      } else if (action === "bought") {
        product.stock -= parseInt(quantity);
        if (product.stock < 0) {
          product.stock = 0;
        }
      }
    }

    db.stockHistory = db.stockHistory.filter((h) => h.id !== id);
    await saveDB(db);
    console.log("Stock history entry deleted:", id);

    // Redirect with preserved filters
    const query = new URLSearchParams({
      dateRange: dateRange || "allTime",
      startDate: startDate || "",
      endDate: endDate || "",
      productId: filterProductId || "",
      action: filterAction || "",
    }).toString();
    res.redirect(`/admin/stock/history${query ? "?" + query : ""}`);
  } catch (err) {
    console.error("Stock history deletion error:", err);
    res.status(500).render("error", {
      message: "Failed to delete stock history entry",
      user: req.user,
    });
  }
});

// Review Management
router.get("/reviews", async (req, res) => {
  try {
    const db = await loadDB();
    console.log("Rendering admin/reviews with:", {
      userId: req.user.id,
      reviewCount: db.products.reduce((acc, p) => acc + (p.reviews?.length || 0), 0),
    });
    res.render("admin/reviews", {
      products: db.products || [],
      users: db.users || [],
      user: req.user,
      categories: db.categories || [],
    });
  } catch (err) {
    console.error("Error rendering reviews page:", {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).render("error", {
      message: "Failed to load reviews page",
      user: req.user,
      query: req.query || {},
    });
  }
});

router.post("/review/edit/:productId", async (req, res) => {
  try {
    const db = await loadDB();
    const product = db.products.find((p) => p.id === req.params.productId);
    if (!product) {
      console.log("Product not found:", { productId: req.params.productId });
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
      });
    }

    const { reviewId, rating, comment } = req.body;
    const review = product.reviews.find((r) => r.id === reviewId);
    if (!review) {
      console.log("Review not found:", { reviewId, productId: req.params.productId });
      return res.status(404).render("error", {
        message: "Review not found",
        user: req.user,
      });
    }

    // Validate rating
    const parsedRating = parseInt(rating);
    if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      console.log("Invalid rating:", { rating, parsedRating, reviewId, productId: req.params.productId });
      return res.status(400).render("admin/reviews", {
        products: db.products || [],
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        error: "Rating must be a number between 1 and 5",
      });
    }

    // Update review
    review.rating = parsedRating;
    review.comment = comment || review.comment; // Preserve existing comment if empty
    review.edited = true;
    review.timestamp = new Date().toISOString();

    await saveDB(db);
    console.log("Review edited:", { reviewId, productId: req.params.productId, userId: req.user.id, rating: parsedRating, comment });
    res.redirect("/admin/reviews");
  } catch (err) {
    console.error("Review edit error:", {
      error: err.message,
      stack: err.stack,
      productId: req.params.productId,
    });
    try {
      const db = await loadDB();
      res.render("admin/reviews", {
        products: db.products || [],
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        error: "Failed to edit review",
      });
    } catch (dbErr) {
      console.error("Error loading db for review edit error:", {
        error: dbErr.message,
        stack: dbErr.stack,
      });
      res.status(500).render("error", {
        message: "Failed to load reviews page",
        user: req.user,
      });
    }
  }
});

router.post("/review/delete/:productId", async (req, res) => {
  try {
    const db = await loadDB();
    const product = db.products.find((p) => p.id === req.params.productId);
    if (!product) {
      console.log("Product not found:", { productId: req.params.productId });
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
      });
    }

    const { reviewId } = req.body;
    product.reviews = product.reviews.filter((r) => r.id !== reviewId);

    await saveDB(db);
    console.log("Review deleted:", { reviewId, productId: req.params.productId, userId: req.user.id });
    res.redirect("/admin/reviews");
  } catch (err) {
    console.error("Review deletion error:", {
      error: err.message,
      stack: err.stack,
      productId: req.params.productId,
    });
    try {
      const db = await loadDB();
      res.render("admin/reviews", {
        products: db.products || [],
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        error: "Failed to delete review",
      });
    } catch (dbErr) {
      console.error("Error loading db for review deletion error:", {
        error: dbErr.message,
        stack: dbErr.stack,
      });
      res.status(500).render("error", {
        message: "Failed to load reviews page",
        user: req.user,
      });
    }
  }
});

// Admin Management
router.get("/admins", async (req, res) => {
  try {
    const db = await loadDB();
    console.log("Admins route - db.admins:", db.admins);
    const adminsToRender = db.admins || [];
    console.log("Admins to render:", adminsToRender);
    res.render("admin/admins", {
      admins: adminsToRender,
      users: db.users || [],
      user: req.user,
      currentUserEmail: req.user.email,
      error: null,
    });
  } catch (err) {
    console.error("Error rendering admins page:", err);
    res.status(500).render("error", {
      message: "Failed to load admins page",
      user: req.user,
      query: req.query || {},
    });
  }
});

router.post("/admins/add", async (req, res) => {
  try {
    const db = await loadDB();
    const { email } = req.body;
    const user = db.users.find((u) => u.email === email);
    if (!user) {
      return res.render("admin/admins", {
        admins: db.admins || [],
        users: db.users || [],
        user: req.user,
        currentUserEmail: req.user.email,
        error: "User not found",
      });
    }
    db.admins = db.admins || [];
    if (!db.admins.includes(email)) {
      db.admins.push(email);
      user.role = "admin";
      user.isAdmin = true;
      if (req.user.email === email) {
        req.session.passport.user = user; // Update session directly
      }
      await saveDB(db);
      console.log("Admin added:", email);
    }
    res.redirect("/admin/admins");
  } catch (err) {
    console.error("Add admin error:", err);
    try {
      const db = await loadDB();
      res.render("admin/admins", {
        admins: db.admins || [],
        users: db.users || [],
        user: req.user,
        currentUserEmail: req.user.email,
        error: "Failed to add admin",
      });
    } catch (dbErr) {
      console.error("Error loading db for add admin error:", dbErr);
      res.status(500).render("error", {
        message: "Failed to load admins page",
        user: req.user,
        query: req.query || {},
      });
    }
  }
});

router.post("/admins/delete/:email", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    console.log("Delete admin request:", { email, currentUser: req.user.email });
    if (email === req.user.email) {
      console.log("User attempted to delete themselves:", email);
      return res.status(400).render("admin/admins", {
        admins: db.admins || [],
        users: db.users || [],
        user: req.user,
        currentUserEmail: req.user.email,
        error: "You cannot delete yourself",
      });
    }

    const db = await loadDB();
    const user = db.users.find((u) => u.email === email);
    if (!user) {
      console.log("User not found for deletion:", email);
      return res.status(404).render("admin/admins", {
        admins: db.admins || [],
        users: db.users || [],
        user: req.user,
        currentUserEmail: req.user.email,
        error: "User not found",
      });
    }

    db.admins = db.admins.filter((adminEmail) => adminEmail !== email);
    user.isAdmin = false;
    user.role = "user";
    console.log("Admin removed:", { email, remainingAdmins: db.admins });

    await saveDB(db);
    res.redirect("/admin/admins");
  } catch (err) {
    console.error("Error deleting admin:", err);
    try {
      const db = await loadDB();
      res.status(500).render("admin/admins", {
        admins: db.admins || [],
        users: db.users || [],
        user: req.user,
        currentUserEmail: req.user.email,
        error: "Failed to delete admin",
      });
    } catch (dbErr) {
      console.error("Error loading db for delete error:", dbErr);
      res.status(500).render("error", {
        message: "Failed to load admins page after error",
        user: req.user,
        query: req.query || {},
      });
    }
  }
});

// Database Save
router.post("/database/save", async (req, res) => {
  try {
    const { dbContent } = req.body;
    if (!dbContent) {
      return res.status(400).json({ error: "Missing dbContent" });
    }
    await fs.writeFile(dbPath, dbContent, "utf8");
    res.redirect("/database");
  } catch (err) {
    console.error("Error saving database content:", err);
    res.status(500).json({ error: "Failed to save content" });
  }
});

// manage categories functionalities

router.get("/categories", async (req, res) => {
  try {
    const db = await loadDB();
    res.render("admin/categories", {
      categories: db.categories || [],
      user: req.user,
      error: null,
      success: null,
    });
  } catch (err) {
    console.error("Error rendering categories page:", err);
    res.status(500).render("error", {
      message: "Failed to load categories page",
      user: req.user,
      query: req.query || {},
    });
  }
});

// Add Category
router.post("/category/add", async (req, res) => {
  try {
    const db = await loadDB();
    const { name } = req.body;
    if (!name || name.trim() === "") {
      return res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "Category name cannot be empty",
        success: null,
      });
    }
    if (db.categories.includes(name)) {
      return res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "Category already exists",
        success: null,
      });
    }
    db.categories.push(name);
    await saveDB(db);
    console.log("Category added:", name);
    res.render("admin/categories", {
      categories: db.categories || [],
      user: req.user,
      error: null,
      success: `Category "${name}" added successfully`,
    });
  } catch (err) {
    console.error("Add category error:", err);
    try {
      const db = await loadDB();
      res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "Failed to add category",
        success: null,
      });
    } catch (dbErr) {
      console.error("Error loading db for add category error:", dbErr);
      res.status(500).render("error", {
        message: "Failed to load categories page",
        user: req.user,
        query: req.query || {},
      });
    }
  }
});

// Edit Category
router.post("/category/edit", async (req, res) => {
  try {
    const db = await loadDB();
    const { oldName, newName } = req.body;
    if (!oldName || !newName || newName.trim() === "") {
      return res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "New category name cannot be empty",
        success: null,
      });
    }
    if (db.categories.includes(newName)) {
      return res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "Category already exists",
        success: null,
      });
    }
    const index = db.categories.indexOf(oldName);
    if (index === -1) {
      return res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "Category not found",
        success: null,
      });
    }
    db.categories[index] = newName;
    // Update products with the old category
    db.products = db.products.map(product => {
      if (product.category === oldName) {
        return { ...product, category: newName };
      }
      return product;
    });
    await saveDB(db);
    console.log("Category edited:", { oldName, newName });
    res.render("admin/categories", {
      categories: db.categories || [],
      user: req.user,
      error: null,
      success: `Category "${oldName}" renamed to "${newName}"`,
    });
  } catch (err) {
    console.error("Edit category error:", err);
    try {
      const db = await loadDB();
      res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "Failed to edit category",
        success: null,
      });
    } catch (dbErr) {
      console.error("Error loading db for edit category error:", dbErr);
      res.status(500).render("error", {
        message: "Failed to load categories page",
        user: req.user,
        query: req.query || {},
      });
    }
  }
});

// Delete Category
router.post("/category/delete", async (req, res) => {
  try {
    const db = await loadDB();
    const { name } = req.body;
    if (!name || !db.categories.includes(name)) {
      return res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "Category not found",
        success: null,
      });
    }
    db.categories = db.categories.filter(category => category !== name);
    // Remove category from products
    db.products = db.products.map(product => {
      if (product.category === name) {
        return { ...product, category: null };
      }
      return product;
    });
    await saveDB(db);
    console.log("Category deleted:", name);
    res.render("admin/categories", {
      categories: db.categories || [],
      user: req.user,
      error: null,
      success: `Category "${name}" deleted successfully`,
    });
  } catch (err) {
    console.error("Delete category error:", err);
    try {
      const db = await loadDB();
      res.render("admin/categories", {
        categories: db.categories || [],
        user: req.user,
        error: "Failed to delete category",
        success: null,
      });
    } catch (dbErr) {
      console.error("Error loading db for delete category error:", dbErr);
      res.status(500).render("error", {
        message: "Failed to load categories page",
        user: req.user,
        query: req.query || {},
      });
    }
  }
});



module.exports = router;