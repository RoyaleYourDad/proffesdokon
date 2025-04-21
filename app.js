const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const fs = require("fs").promises;
const path = require("path");
const dotenv = require("dotenv");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const sizeOf = require("image-size");

dotenv.config();

const app = express();
const dbPath = path.join(__dirname, "database.json");

// Enable trust proxy for Railway
app.set("trust proxy", 1);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only images are allowed"), false);
    }
  },
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.locals.ejs = { debug: true };
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static("public/uploads"));

// Enforce HTTPS in production
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.header("x-forwarded-proto") !== "https") {
      return res.redirect(`https://${req.header("host")}${req.url}`);
    }
    next();
  });
}

// Session configuration with MemoryStore
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-secret",
    resave: false,
    saveUninitialized: false,
    store: undefined, // Use default MemoryStore
    cookie: {
      secure: "auto",
      maxAge: 12 * 60 * 60 * 1000, // 12 hours
      sameSite: "lax",
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Middleware for debugging sessions
app.use((req, res, next) => {
  console.log("Session ID:", req.sessionID);
  console.log("Session data:", req.session);
  console.log(
    "Request user:",
    req.user
      ? {
          id: req.user.id,
          email: req.user.email,
          role: req.user.role,
          isAdmin: req.user.isAdmin,
        }
      : "No user"
  );
  if (!req.user && req.session.passport && !req.path.startsWith("/auth")) {
    console.log("Missing user but session exists, redirecting to login", {
      sessionID: req.sessionID,
      path: req.path,
    });
    return res.redirect("/auth/login?error=session_expired");
  }
  req.upload = upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "previewImages", maxCount: 8 },
  ]);
  next();
});

// Cached database and lock
let dbCache = null;
let dbLock = false;

const loadDB = async () => {
  if (dbCache && !dbLock) return dbCache;
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
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
    console.log("Database saved:", { users: data.users.length, products: data.products.length });
  } catch (err) {
    console.error("Error saving database:", err);
    throw err;
  } finally {
    dbLock = false;
  }
};

// ImgBB upload/delete functions (unchanged)
async function uploadToImgBB(file) {
  try {
    const dimensions = sizeOf(file.buffer);
    if (dimensions.width < 512 || dimensions.height < 512) {
      throw new Error("Image must be at least 512x512 pixels");
    }

    const imgbbApiKeys = [
      process.env.IMGBB_API_KEY_1,
      process.env.IMGBB_API_KEY_2,
      process.env.IMGBB_API_KEY_3,
    ].filter((key) => key);

    for (const apiKey of imgbbApiKeys) {
      try {
        const formData = new FormData();
        formData.append("image", file.buffer.toString("base64"));
        formData.append("key", apiKey);

        const response = await axios.post("https://api.imgbb.com/1/upload", formData, {
          headers: formData.getHeaders(),
          timeout: 10000,
        });

        if (response.data.success) {
          return {
            url: response.data.data.url,
            delete_url: response.data.data.delete_url,
          };
        }
      } catch (err) {
        console.error(`ImgBB upload failed with key ${apiKey.slice(0, 4)}...:`, err.message);
        continue;
      }
    }
    throw new Error("All ImgBB API keys failed");
  } catch (err) {
    throw err;
  }
}

async function deleteFromImgBB(deleteUrl) {
  try {
    await axios.get(deleteUrl, { timeout: 5000 });
    return true;
  } catch (err) {
    console.error("ImgBB delete failed:", err.message);
    return false;
  }
}

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:
        process.env.NODE_ENV === "production"
          ? process.env.GOOGLE_CALLBACK_URL
          : "http://localhost:3000/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      console.log("Google auth callback:", {
        googleId: profile.id,
        email: profile.emails[0].value,
        displayName: profile.displayName,
      });
      const db = await loadDB();
      let user = db.users.find((u) => u.googleId === profile.id);

      if (!user) {
        user = {
          id: Date.now().toString(),
          googleId: profile.id,
          email: profile.emails[0].value,
          displayName: profile.displayName,
          role: "user",
          cart: [],
          cartCount: 0,
          isAdmin: false,
        };
        db.users.push(user);
        await saveDB(db);
      }

      user.isAdmin = user.role === "admin";
      console.log("Auth user:", {
        id: user.id,
        email: user.email,
        role: user.role,
        isAdmin: user.isAdmin,
      });
      return done(null, user);
    }
  )
);

passport.serializeUser((user, done) => {
  console.log("Serializing user:", { id: user.id, email: user.email });
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  console.log("Deserializing user ID:", id);
  try {
    const db = await loadDB();
    const user = db.users.find((u) => u.id === id);
    if (user) {
      user.isAdmin = user.role === "admin";
      console.log("Deserialized user:", {
        id: user.id,
        email: user.email,
        role: user.role,
        isAdmin: user.isAdmin,
      });
      done(null, user);
    } else {
      console.error("Deserialize failed: User not found", id);
      done(null, false);
    }
  } catch (err) {
    console.error("Deserialize error:", err);
    done(err, null);
  }
});

app.locals.uploadToImgBB = uploadToImgBB;
app.locals.deleteFromImgBB = deleteFromImgBB;

// Routes
app.use("/product", require("./routes/product"));
app.use("/", require("./routes/index"));
app.use("/admin", require("./routes/admin"));
app.use("/auth", require("./routes/auth"));
app.use("/cart", require("./routes/cart"));

// Serve database.json (admin-only)
const serveDatabase = async (req, res) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).render("error", {
      message: "Access denied: Admin privileges required",
      user: req.user,
      query: req.query || {},
    });
  }
  try {
    if (req.query.view === "raw") {
      const dbData = await fs.readFile(dbPath, "utf8");
      res.setHeader("Content-Type", "application/json");
      res.send(dbData);
    } else if (req.query.download === "true") {
      res.download(dbPath, "database.json", (err) => {
        if (err) {
          console.error("Error downloading database.json:", err);
          if (!res.headersSent) {
            res.status(500).render("error", {
              message: "Failed to download database",
              user: req.user,
              query: req.query || {},
            });
          }
        }
      });
    } else {
      const dbData = await fs.readFile(dbPath, "utf8");
      res.render("database", {
        user: req.user,
        query: req.query || {},
        dbContent: dbData,
        dbPath: dbPath,
      });
    }
  } catch (err) {
    console.error("Error reading database.json:", err);
    res.status(500).render("error", {
      message: "Failed to load database",
      user: req.user,
      query: req.query || {},
    });
  }
};

// Database routes
app.get("/database", serveDatabase);
app.get("/database.json", serveDatabase);

// Error handling
app.use((err, req, res, next) => {
  console.error("Server error:", {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    user: req.user ? { id: req.user.id, email: req.user.email } : "No user",
  });
  if (res.headersSent) {
    console.warn("Headers already sent, skipping error response");
    return next();
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).render("error", {
      message: "File upload error",
      user: req.user,
      query: req.query || {},
    });
  }
  res.status(500).render("error", {
    message: err.message || "Something went wrong!",
    user: req.user,
    query: req.query || {},
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

// Export loadDB and saveDB for use in routes
module.exports = { loadDB, saveDB };