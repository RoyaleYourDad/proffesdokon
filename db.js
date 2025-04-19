const fs = require("fs").promises;
const path = require("path");

const dbPath = path.join(__dirname, "database.json");

// Cached database and lock
let dbCache = null;
let dbLock = false;

const loadDB = async () => {
  // Always read from file to ensure fresh data
  try {
    const data = JSON.parse(await fs.readFile(dbPath, "utf8"));
    dbCache = {
      products: (data.products || []).map((p) => ({
        ...p,
        reviews: (p.reviews || []).map((r) => ({ ...r, edited: r.edited || false })),
      })),
      categories: data.categories || [],
      users: (data.users || []).map((user) => ({
        ...user,
        role: user.role || "user",
        cart: user.cart || [],
        cartCount: user.cartCount || 0,
        isAdmin: user.role === "admin",
      })),
      admins: data.admins || [],
      stockHistory: data.stockHistory || [],
    };
    console.log("Database loaded:", { users: dbCache.users.length, products: dbCache.products.length });
    return dbCache;
  } catch (err) {
    console.error("Failed to load database.json:", {
      path: dbPath,
      error: err.message,
    });
    // Return cached data if available, else empty structure
    if (dbCache) {
      console.log("Returning cached database due to load error");
      return dbCache;
    }
    dbCache = { products: [], categories: [], users: [], admins: [], stockHistory: [] };
    return dbCache;
  }
};

const saveDB = async (data) => {
  while (dbLock) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  dbLock = true;
  try {
    dbCache = data;
    console.log("Saving database:", {
      users: data.users.length,
      products: data.products.length,
      reviews: data.products.reduce((sum, p) => sum + (p.reviews || []).length, 0),
    });
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
    console.log("Database successfully saved to disk:", { path: dbPath });
  } catch (err) {
    console.error("Error saving database:", {
      path: dbPath,
      error: err.message,
      stack: err.stack,
    });
    throw err; // Rethrow to ensure callers handle the error
  } finally {
    dbLock = false;
  }
};

module.exports = { loadDB, saveDB };