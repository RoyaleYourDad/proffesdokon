const express = require("express");
const fs = require("fs").promises;
const path = require("path");
const router = express.Router();
const ExcelJS = require("exceljs");
const dbPath = path.join(__dirname, "../database.json");

const loadDB = async () => {
  try {
    return await require("../app").loadDB();
  } catch (err) {
    console.error("Error loading database:", err);
    return { products: [], categories: [], users: [], stockHistory: [], admins: [] };
  }
};

const saveDB = async (data) => {
  try {
    await require("../app").saveDB(data);
    console.log("Database written successfully");
  } catch (err) {
    console.error("Error saving database:", err);
    throw err;
  }
};

// Middleware to check admin
router.use(async (req, res, next) => {
  if (!req.user) {
    console.log("Admin middleware: No user, redirecting to /auth/login");
    return res.redirect("/auth/login");
  }
  const db = await loadDB();
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user || !user.isAdmin) {
    console.log(`Admin middleware: User ${req.user.email} is not admin, redirecting to /`);
    return res.redirect("/");
  }
  console.log(`Admin middleware: User ${req.user.email} is admin, proceeding`);
  next();
});

// Admin Dashboard
router.get("/", async (req, res) => {
  const db = await loadDB();
  console.log("Rendering admin/index with:", {
    userId: req.user.id,
    productCount: db.products.length,
    userCount: db.users.length,
  });
  res.render("admin/index", {
    products: db.products || [],
    user: req.user,
    categories: db.categories || [],
    users: db.users || [],
  });
});

// Add Product Page
router.get("/add", async (req, res) => {
  const db = await loadDB();
  res.render("admin/edit", {
    product: null,
    categories: db.categories || [],
    user: req.user,
    error: null,
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
    if (err) {
      console.error("Upload error:", err);
      return res.render("admin/edit", {
        product: null,
        categories: (await loadDB()).categories || [],
        user: req.user,
        error: err.message,
      });
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
      res.render("admin/edit", {
        product: null,
        categories: (await loadDB()).categories || [],
        user: req.user,
        error: "Failed to add product",
      });
    }
  });
});

// Edit Product Page
router.get("/edit/:id", async (req, res) => {
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
});

// Update Product
router.post("/edit/:id", (req, res) => {
  req.upload(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      const db = await loadDB();
      const product = db.products.find((p) => p.id === req.params.id);
      return res.render("admin/edit", {
        product,
        categories: db.categories || [],
        users: db.users || [],
        user: req.user,
        error: err.message,
      });
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
      const db = await loadDB();
      const product = db.products.find((p) => p.id === req.params.id);
      res.render("admin/edit", {
        product,
        categories: db.categories || [],
        users: db.users || [],
        user: req.user,
        error: "Failed to edit product",
      });
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
router.post("/category/add", async (req, res) => {
  const db = await loadDB();
  const { name } = req.body;
  if (name && !db.categories.includes(name)) {
    db.categories.push(name);
    await saveDB(db);
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false, error: "Invalid or duplicate category" });
  }
});

// User Management
router.get("/users", async (req, res) => {
  const db = await loadDB();
  res.render("admin/users", {
    users: db.users || [],
    user: req.user,
    categories: db.categories || [],
  });
});

router.post("/users/:id/role", async (req, res) => {
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
});

// Stock Management
router.get("/stock", async (req, res) => {
  const db = await loadDB();
  res.render("admin/stock", {
    products: db.products || [],
    user: req.user,
    categories: db.categories || [],
  });
});

router.post("/stock/update", async (req, res) => {
  try {
    const db = await loadDB();
    const { productId, action, quantity, notes } = req.body;
    console.log("Stock update request:", { productId, action, quantity, notes, userId: req.user.id });
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
    product.stock = action === "sold" ? product.stock - qty : product.stock + qty;
    db.stockHistory = db.stockHistory || [];
    const historyEntry = {
      id: Date.now().toString(),
      productId,
      action,
      quantity: qty,
      notes: notes || "",
      updatedBy: req.user.id,
      updatedAt: new Date().toISOString(),
    };
    db.stockHistory.push(historyEntry);
    await saveDB(db);
    console.log("Stock updated:", { productId, action, quantity: qty, userId: req.user.id });
    res.render("admin/stock", {
      products: db.products,
      user: req.user,
      categories: db.categories || [],
      success: `Stock updated: ${action === "sold" ? "Sold" : "Added"} ${qty} of ${product.name}`,
    });
  } catch (err) {
    console.error("Stock update error:", err);
    res.render("admin/stock", {
      products: (await loadDB()).products || [],
      user: req.user,
      categories: (await loadDB()).categories || [],
      error: "Failed to update stock: Server error",
    });
  }
});

// Stock History
router.get("/stock/history", async (req, res) => {
  const db = await loadDB();
  let { dateRange, startDate, endDate, productId, action } = req.query;

  let filteredHistory = (db.stockHistory || []).map((entry) => ({
    ...entry,
    updatedAt: entry.updatedAt || entry.timestamp || new Date().toISOString(),
  }));
  console.log("Stock history raw:", filteredHistory.length, filteredHistory);

  if (!dateRange) dateRange = "all";
  const now = new Date();
  if (dateRange === "lastDay") {
    const lastDay = new Date(now.setDate(now.getDate() - 1));
    filteredHistory = filteredHistory.filter((entry) => new Date(entry.updatedAt) >= lastDay);
  } else if (dateRange === "lastWeek") {
    const lastWeek = new Date(now.setDate(now.getDate() - 7));
    filteredHistory = filteredHistory.filter((entry) => new Date(entry.updatedAt) >= lastWeek);
  } else if (dateRange === "lastMonth") {
    const lastMonth = new Date(now.setDate(now.getDate() - 30));
    filteredHistory = filteredHistory.filter((entry) => new Date(entry.updatedAt) >= lastMonth);
  } else if (dateRange === "custom" && startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    filteredHistory = filteredHistory.filter(
      (entry) => new Date(entry.updatedAt) >= start && new Date(entry.updatedAt) <= end
    );
  }

  if (productId) {
    filteredHistory = filteredHistory.filter((entry) => entry.productId === productId);
  }

  if (action) {
    filteredHistory = filteredHistory.filter((entry) => entry.action === action);
  }

  console.log("Stock history filtered:", filteredHistory.length, filteredHistory);

  res.render("admin/stock-history", {
    history: filteredHistory,
    products: db.products || [],
    users: db.users || [],
    user: req.user,
    categories: db.categories || [],
    dateRange,
    startDate,
    endDate,
    productId,
    action,
  });
});

router.post("/stock/history/delete", async (req, res) => {
  try {
    const db = await loadDB();
    const { id, action, quantity, productId } = req.body;

    const entry = db.stockHistory.find((h) => h.id === id);
    if (!entry) {
      return res.redirect("/admin/stock/history");
    }

    const product = db.products.find((p) => p.id === productId);
    if (product) {
      if (action === "sold") {
        product.stock += parseInt(quantity);
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
    res.redirect(
      `/admin/stock/history?dateRange=${req.body.dateRange || req.query.dateRange || "lastDay"}&startDate=${req.body.startDate || req.query.startDate || ""
      }&endDate=${req.body.endDate || req.query.endDate || ""}&productId=${req.body.productId || req.query.productId || ""
      }&action=${req.body.action || req.query.action || ""}`
    );
  } catch (err) {
    console.error("Stock history deletion error:", err);
    res.status(500).render("error", {
      message: "Failed to delete stock history entry",
      user: req.user,
    });
  }
});

router.post("/stock/history/edit", async (req, res) => {
  try {
    const db = await loadDB();
    const { id, productId, action, quantity, notes, dateRange, startDate, endDate } = req.body;
    const qty = parseInt(quantity);

    const entry = db.stockHistory.find((h) => h.id === id);
    if (!entry) {
      return res.status(404).render("error", {
        message: "Stock history entry not found",
        user: req.user,
      });
    }

    const product = db.products.find((p) => p.id === productId);
    if (!product) {
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
      });
    }

    if (!["sold", "bought"].includes(action) || isNaN(qty) || qty <= 0) {
      return res.status(400).render("admin/stock-history", {
        history: db.stockHistory || [],
        products: db.products || [],
        users: db.users || [],
        user: req.user,
        categories: db.categories || [],
        dateRange,
        startDate,
        endDate,
        productId,
        action,
        error: "Invalid action or quantity",
      });
    }

    if (entry.action === "sold") {
      product.stock += entry.quantity;
    } else if (entry.action === "bought") {
      product.stock -= entry.quantity;
      if (product.stock < 0) {
        product.stock = 0;
      }
    }

    if (action === "sold") {
      if (product.stock < qty) {
        return res.status(400).render("admin/stock-history", {
          history: db.stockHistory || [],
          products: db.products || [],
          users: db.users || [],
          user: req.user,
          categories: db.categories || [],
          dateRange,
          startDate,
          endDate,
          productId,
          action,
          error: `Cannot sell ${qty} items. Only ${product.stock} in stock.`,
        });
      }
      product.stock -= qty;
    } else if (action === "bought") {
      product.stock += qty;
    }

    entry.action = action;
    entry.quantity = qty;
    entry.notes = notes || "";
    entry.timestamp = new Date().toISOString();
    entry.updatedBy = req.user.id;

    await saveDB(db);
    console.log("Stock history entry edited:", { id, productId, action, quantity: qty });
    res.redirect(
      `/admin/stock/history?dateRange=${dateRange || "lastDay"}&startDate=${startDate || ""}&endDate=${endDate || ""
      }&productId=${productId || ""}&action=${action || ""}`
    );
  } catch (err) {
    console.error("Stock history edit error:", err);
    res.status(500).render("error", {
      message: "Failed to edit stock history entry",
      user: req.user,
    });
  }
});

router.get("/stock/history/export", async (req, res) => {
  try {
    const db = await loadDB();
    let { dateRange, startDate, endDate, productId, action } = req.query;

    let filteredHistory = (db.stockHistory || []).map((entry) => ({
      ...entry,
      updatedAt: entry.updatedAt || entry.timestamp || new Date().toISOString(),
    }));
    console.log("Export raw history:", filteredHistory.length);

    if (!dateRange) dateRange = "all";
    const now = new Date();
    if (dateRange === "lastDay") {
      const lastDay = new Date(now.setDate(now.getDate() - 1));
      filteredHistory = filteredHistory.filter((entry) => new Date(entry.updatedAt) >= lastDay);
    } else if (dateRange === "lastWeek") {
      const lastWeek = new Date(now.setDate(now.getDate() - 7));
      filteredHistory = filteredHistory.filter((entry) => new Date(entry.updatedAt) >= lastWeek);
    } else if (dateRange === "lastMonth") {
      const lastMonth = new Date(now.setDate(now.getDate() - 30));
      filteredHistory = filteredHistory.filter((entry) => new Date(entry.updatedAt) >= lastMonth);
    } else if (dateRange === "custom" && startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      filteredHistory = filteredHistory.filter(
        (entry) => new Date(entry.updatedAt) >= start && new Date(entry.updatedAt) <= end
      );
    }

    if (productId) {
      filteredHistory = filteredHistory.filter((entry) => entry.productId === productId);
    }

    if (action) {
      filteredHistory = filteredHistory.filter((entry) => entry.action === action);
    }

    console.log("Export filtered history:", filteredHistory.length, filteredHistory);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Stock History");
    worksheet.columns = [
      { header: "Date & Time", key: "updatedAt", width: 20 },
      { header: "Product", key: "productName", width: 20 },
      { header: "Action", key: "action", width: 10 },
      { header: "Quantity", key: "quantity", width: 10 },
      { header: "Notes", key: "notes", width: 30 },
      { header: "Updated By", key: "updatedBy", width: 20 },
    ];

    filteredHistory.forEach((entry) => {
      const product = db.products.find((p) => p.id === entry.productId);
      const user = db.users.find((u) => u.id === entry.updatedBy);
      worksheet.addRow({
        updatedAt: new Date(entry.updatedAt).toLocaleString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
        productName: product ? product.name : "Unknown",
        action: entry.action,
        quantity: entry.quantity,
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
    res.status(500).render("admin/stock-history", {
      history: [],
      products: (await loadDB()).products || [],
      users: (await loadDB()).users || [],
      user: req.user,
      categories: (await loadDB()).categories || [],
      dateRange,
      startDate,
      endDate,
      productId,
      action,
      error: "Failed to export stock history",
    });
  }
});

router.post("/review/delete/:productId", async (req, res) => {
  try {
    const db = await loadDB();
    const product = db.products.find((p) => p.id === req.params.productId);
    if (!product) {
      return res.status(404).render("error", {
        message: "Product not found",
        user: req.user,
      });
    }

    const { reviewId } = req.body;
    product.reviews = product.reviews.filter((r) => r.id !== reviewId);

    await saveDB(db);
    console.log("Review deleted:", reviewId);
    res.redirect(`/admin/edit/${req.params.productId}`);
  } catch (err) {
    console.error("Review deletion error:", err);
    res.status(500).render("error", {
      message: "Failed to delete review",
      user: req.user,
    });
  }
});

// Admin Management
router.get("/admins", async (req, res) => {
  const db = await loadDB();
  res.render("admin/admins", {
    admins: db.admins || [],
    users: db.users || [],
    user: req.user,
    error: null,
  });
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
        error: "User not found",
      });
    }
    db.admins = db.admins || [];
    if (!db.admins.includes(email)) {
      db.admins.push(email);
      user.role = "admin";
      user.isAdmin = true;
      if (req.user.email === email) {
        req.session.passport.user = user; // Update session
      }
      await saveDB(db);
      console.log("Admin added:", email);
    }
    res.redirect("/admin/admins");
  } catch (err) {
    console.error("Add admin error:", err);
    res.render("admin/admins", {
      admins: (await loadDB()).admins || [],
      users: (await loadDB()).users || [],
      user: req.user,
      error: "Failed to add admin",
    });
  }
});

router.post("/admins/delete/:email", async (req, res) => {
  try {
    const db = await loadDB();
    const email = decodeURIComponent(req.params.email);
    db.admins = db.admins.filter((e) => e !== email);
    const user = db.users.find((u) => u.email === email);
    if (user) {
      user.role = "user";
      user.isAdmin = false;
      if (req.user.email === email) {
        req.session.passport.user = user; // Update session
      }
    }
    await saveDB(db);
    console.log("Admin removed:", email);
    res.redirect("/admin/admins");
  } catch (err) {
    console.error("Remove admin error:", err);
    res.render("admin/admins", {
      admins: (await loadDB()).admins || [],
      users: (await loadDB()).users || [],
      user: req.user,
      error: "Failed to remove admin",
    });
  }
});

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

module.exports = router;