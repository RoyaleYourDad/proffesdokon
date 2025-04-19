const fs = require("fs").promises;
const path = require("path");

const dbPath = path.join(__dirname, "database.json");

// Cached database and lock
let dbCache = null;
let dbLock = false;

const loadDB = async () => {
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
      stockHistory: (data.stockHistory || []).map((entry) => ({
        ...entry,
        notes: (entry.notes || "").replace(/[\r\n]+/g, " ").trim(),
        date: entry.date || entry.updatedAt || new Date().toISOString(), // Add date field, fallback to updatedAt
        updatedAt: entry.updatedAt || entry.timestamp || new Date().toISOString(),
        timestamp: undefined, // Remove timestamp to avoid confusion
      })),
    };
    console.log("Database loaded:", {
      users: dbCache.users.length,
      products: dbCache.products.length,
      admins: dbCache.admins,
      stockHistory: dbCache.stockHistory.length,
    });
    // Save migrated data (if any changes were made)
    await saveDB(dbCache);
    return dbCache;
  } catch (err) {
    console.error("Failed to load database.json:", {
      path: dbPath,
      error: err.message,
    });
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
      admins: data.admins,
      stockHistory: data.stockHistory.length,
    });
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
    console.log("Database successfully saved to disk:", { path: dbPath });
  } catch (err) {
    console.error("Error saving database:", {
      path: dbPath,
      error: err.message,
      stack: err.stack,
    });
    throw err;
  } finally {
    dbLock = false;
  }
};

module.exports = { loadDB, saveDB };