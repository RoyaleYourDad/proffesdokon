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

const ensureAuthenticated = (req, res, next) => {
    if (!req.user) {
        return res.redirect("/auth/login");
    }
    next();
};

// GET /cart
router.get("/", ensureAuthenticated, (req, res) => {
    const db = loadDB();
    const user = db.users.find((u) => u.id === req.user.id);
    if (!user) {
        console.log("Cart: User not found", req.user.id);
        return res.redirect("/auth/login");
    }

    const cartItems = user.cart.map((item) => {
        const product = db.products.find((p) => p.id === item.productId);
        if (!product) {
            console.log("Cart: Product not found", item.productId);
            return null;
        }
        return { ...item, product };
    }).filter(Boolean);

    console.log("Cart items:", cartItems.map(item => ({
        name: item.product.name,
        price: item.product.price,
        discountPrice: item.product.discountPrice,
        expiry: item.product.discountExpiry,
        quantity: item.quantity
    })));

    res.render("cart", {
        cartItems,
        user: req.user,
    });
});

// POST /cart/add
router.post("/add", ensureAuthenticated, (req, res) => {
    const { productId, quantity = 1 } = req.body;
    const db = loadDB();
    const user = db.users.find((u) => u.id === req.user.id);
    const product = db.products.find((p) => p.id === productId);

    if (!user || !product) {
        console.log("Add to cart failed: User or product not found", { userId: req.user.id, productId });
        return res.redirect("/");
    }

    user.cart = user.cart || [];
    const cartItem = user.cart.find((item) => item.productId === productId);

    if (cartItem) {
        cartItem.quantity += parseInt(quantity);
    } else {
        user.cart.push({ productId, quantity: parseInt(quantity) });
    }

    user.cartCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
    saveDB(db);
    console.log("Added to cart:", { productId, quantity, user: req.user.email });
    res.redirect("/cart");
});

// POST /cart/update/:productId
router.post("/update/:productId", ensureAuthenticated, (req, res) => {
    const { productId } = req.params;
    const { quantity } = req.body;
    const db = loadDB();
    const user = db.users.find((u) => u.id === req.user.id);

    if (!user) {
        console.log("Update cart failed: User not found", req.user.id);
        return res.redirect("/auth/login");
    }

    const cartItem = user.cart.find((item) => item.productId === productId);
    if (cartItem && parseInt(quantity) >= 1) {
        cartItem.quantity = parseInt(quantity);
        console.log("Updated cart:", { productId, quantity, user: req.user.email });
    } else if (cartItem && parseInt(quantity) < 1) {
        user.cart = user.cart.filter((item) => item.productId !== productId);
        console.log("Removed invalid quantity item:", { productId, user: req.user.email });
    }

    user.cartCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
    saveDB(db);
    res.redirect("/cart");
});

// POST /cart/remove/:productId
router.post("/remove/:productId", ensureAuthenticated, (req, res) => {
    const { productId } = req.params;
    const db = loadDB();
    const user = db.users.find((u) => u.id === req.user.id);

    if (!user) {
        console.log("Remove from cart failed: User not found", req.user.id);
        return res.redirect("/auth/login");
    }

    user.cart = user.cart.filter((item) => item.productId !== productId);
    user.cartCount = user.cart.reduce((sum, item) => sum + item.quantity, 0);
    saveDB(db);
    console.log("Removed from cart:", { productId, user: req.user.email });
    res.redirect("/cart");
});

module.exports = router;