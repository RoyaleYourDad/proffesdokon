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
    return {
      products: [],
      users: [],
      categories: [],
      stockHistory: [],
      admins: [],
    };
  }
};

const saveDB = (data) => {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving database:", err);
  }
};

router.use((req, res, next) => {
  if (!req.user) {
    console.log("Cart middleware: No user, redirecting to /auth/login");
    return res.redirect("/auth/login");
  }
  next();
});

router.get("/count", (req, res) => {
  try {
    const db = loadDB();
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).json({ cartCount: 0 });
    }
    const cartCount = user.cart ? user.cart.reduce((sum, item) => sum + item.quantity, 0) : 0;
    console.log("Cart count fetched:", { userId: req.user.id, cartCount });
    res.json({ cartCount });
  } catch (err) {
    console.error("Error fetching cart count:", err);
    res.status(500).json({ cartCount: 0 });
  }
});

router.post("/add", (req, res) => {
  try {
    const db = loadDB();
    const { productId, quantity } = req.body;
    const product = db.products.find((p) => p.id === productId);
    if (!product) {
      return req.xhr
        ? res.status(404).json({ error: "Product not found" })
        : res.status(404).render("error", {
            message: "Product not found",
            user: req.user,
          });
    }
    const qty = parseInt(quantity) || 1;
    if (qty <= 0 || qty > product.stock) {
      return req.xhr
        ? res.status(400).json({ error: `Invalid quantity. Available stock: ${product.stock}` })
        : res.status(400).render("product", {
            product,
            user: req.user,
            users: db.users || [],
            error: `Invalid quantity. Available stock: ${product.stock}`,
          });
    }
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) {
      return req.xhr
        ? res.status(404).json({ error: "User not found" })
        : res.status(404).render("error", {
            message: "User not found",
            user: req.user,
          });
    }
    user.cart = user.cart || [];
    const cartItem = user.cart.find((item) => item.productId === productId);
    if (cartItem) {
      cartItem.quantity = Math.min(cartItem.quantity + qty, product.stock);
    } else {
      user.cart.push({ productId, quantity: qty });
    }
    user.cartCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
    saveDB(db);
    console.log("Cart updated:", {
      userId: req.user.id,
      productId,
      quantity: qty,
    });

    if (req.xhr) {
      return res.json({
        success: true,
        cartCount: user.cartCount,
      });
    }

    res.setHeader("X-Cart-Updated", "true");
    res.redirect(`/product/${productId}`);
  } catch (err) {
    console.error("Add to cart error:", err);
    return req.xhr
      ? res.status(500).json({ error: "Failed to add to cart" })
      : res.status(500).render("error", {
          message: "Failed to add to cart",
          user: req.user,
        });
  }
});

router.post("/update/:productId", (req, res) => {
  try {
    const db = loadDB();
    const productId = req.params.productId;
    const quantity = parseInt(req.body.quantity);
    const product = db.products.find((p) => p.id === productId);
    if (!product) {
      return req.xhr
        ? res.status(404).json({ error: "Product not found" })
        : res.status(404).render("error", {
            message: "Product not found",
            user: req.user,
          });
    }
    if (isNaN(quantity) || quantity <= 0 || quantity > product.stock) {
      const user = db.users.find((u) => u.id === req.user.id);
      return req.xhr
        ? res.status(400).json({ error: `Invalid quantity. Available stock: ${product.stock}` })
        : res.status(400).render("cart", {
            cartItems: user.cart
              ? user.cart.map((item) => ({
                  ...item,
                  product: db.products.find((p) => p.id === item.productId),
                }))
              : [],
            user: req.user,
            categories: db.categories || [],
            error: `Invalid quantity. Available stock: ${product.stock}`,
          });
    }
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) {
      return req.xhr
        ? res.status(404).json({ error: "User not found" })
        : res.status(404).render("error", {
            message: "User not found",
            user: req.user,
          });
    }
    user.cart = user.cart || [];
    const cartItem = user.cart.find((item) => item.productId === productId);
    if (!cartItem) {
      return req.xhr
        ? res.status(400).json({ error: "Item not in cart" })
        : res.status(400).render("cart", {
            cartItems: user.cart
              ? user.cart.map((item) => ({
                  ...item,
                  product: db.products.find((p) => p.id === item.productId),
                }))
              : [],
            user: req.user,
            categories: db.categories || [],
            error: "Item not in cart",
          });
    }
    cartItem.quantity = quantity;
    user.cartCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
    saveDB(db);
    console.log("Cart quantity updated:", {
      userId: req.user.id,
      productId,
      quantity,
    });

    if (req.xhr) {
      const updatedCartItems = user.cart.map((item) => {
        const product = db.products.find((p) => p.id === item.productId);
        return { ...item, product };
      });
      const subtotal = updatedCartItems.reduce(
        (sum, item) =>
          sum +
          (item.product.discountPrice &&
          item.product.discountPrice <= item.product.price &&
          (!item.product.discountExpiry || new Date(item.product.discountExpiry) > new Date())
            ? item.product.discountPrice
            : item.product.price) *
          item.quantity,
        0
      );
      const totalSavings = updatedCartItems.reduce((sum, item) => {
        if (
          item.product.discountPrice &&
          item.product.discountPrice <= item.product.price &&
          (!item.product.discountExpiry || new Date(item.product.discountExpiry) > new Date())
        ) {
          return sum + (item.product.price - item.product.discountPrice) * item.quantity;
        }
        return sum;
      }, 0);
      return res.json({
        success: true,
        cartItems: updatedCartItems,
        subtotal: subtotal.toFixed(2),
        totalSavings: totalSavings.toFixed(2),
        total: subtotal.toFixed(2),
      });
    }

    res.setHeader("X-Cart-Updated", "true");
    res.redirect("/cart");
  } catch (err) {
    console.error("Update cart error:", err);
    return req.xhr
      ? res.status(500).json({ error: "Failed to update cart" })
      : res.status(500).render("error", {
          message: "Failed to update cart",
          user: req.user,
        });
  }
});

router.post("/remove/:productId", (req, res) => {
  try {
    const db = loadDB();
    const productId = req.params.productId;
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).render("error", {
        message: "User not found",
        user: req.user,
      });
    }
    user.cart = user.cart || [];
    user.cart = user.cart.filter((item) => item.productId !== productId);
    user.cartCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
    saveDB(db);
    console.log("Cart item removed:", { userId: req.user.id, productId });
    res.setHeader("X-Cart-Updated", "true");
    res.redirect("/cart");
  } catch (err) {
    console.error("Remove from cart error:", err);
    res.status(500).render("error", {
      message: "Failed to remove from cart",
      user: req.user,
    });
  }
});

router.post("/remove", (req, res) => {
  try {
    const db = loadDB();
    const { productId } = req.body;
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).render("error", {
        message: "User not found",
        user: req.user,
      });
    }
    user.cart = user.cart || [];
    user.cart = user.cart.filter((item) => item.productId !== productId);
    user.cartCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
    saveDB(db);
    console.log("Cart item removed:", { userId: req.user.id, productId });
    res.setHeader("X-Cart-Updated", "true");
    res.redirect("/cart");
  } catch (err) {
    console.error("Remove from cart error:", err);
    res.status(500).render("error", {
      message: "Failed to remove from cart",
      user: req.user,
    });
  }
});

router.get("/", (req, res) => {
  try {
    const db = loadDB();
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) {
      return res.status(404).render("error", {
        message: "User not found",
        user: req.user,
      });
    }
    const cartItems = user.cart
      ? user.cart.map((item) => {
          const product = db.products.find((p) => p.id === item.productId);
          return { ...item, product };
        })
      : [];
    res.render("cart", {
      cartItems,
      user: req.user,
      categories: db.categories || [],
    });
  } catch (err) {
    console.error("View cart error:", err);
    res.status(500).render("error", {
      message: "Failed to load cart",
      user: req.user,
    });
  }
});

module.exports = router;