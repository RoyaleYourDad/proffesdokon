const express = require("express");
const session = require("express-session");
const FileStore = require("session-file-store")(session);
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const sizeOf = require("image-size");

dotenv.config();

const app = express();
const dbPath = path.join(__dirname, "database.json");
const sessionPath = path.join(__dirname, "sessions");

// Ensure sessions directory exists and is writable
try {
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
    console.log(`Created sessions directory at ${sessionPath}`);
  }
  fs.chmodSync(sessionPath, "755");
} catch (err) {
  console.error("Failed to initialize sessions directory:", {
    path: sessionPath,
    error: err.message,
    stack: err.stack,
  });
}

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

app.use(
  session({
    store: new FileStore({
      path: sessionPath,
      ttl: 12 * 60 * 60, // 12 hours
      retries: 3,
      logFn: (msg) => console.error(`Session store error: ${msg}`),
      fileExtension: ".json",
      reapInterval: 60 * 60, // Clean up expired sessions hourly
      reapAsync: true,
      create: (filename) => console.log(`Created session file: ${filename}`),
      destroy: (filename) => console.log(`Deleted session file: ${filename}`),
    }),
    secret: process.env.SESSION_SECRET || "fallback-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production" ? true : "auto",
      maxAge: 12 * 60 * 60 * 1000, // 12 hours
      sameSite: "lax",
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Cached database
let dbCache = null;

const loadDB = () => {
  if (dbCache) return dbCache;
  try {
    const data = JSON.parse(fs.readFileSync(dbPath, "utf8"));
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
    return dbCache;
  } catch (err) {
    console.error("Failed to load database.json:", {
      path: dbPath,
      error: err.message,
      stack: err.stack,
    });
    dbCache = { products: [], categories: [], users: [], admins: [], stockHistory: [] };
    return dbCache;
  }
};

const saveDB = (data) => {
  try {
    dbCache = data;
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error saving database:", err);
  }
};

const imgbbApiKeys = [
  process.env.IMGBB_API_KEY_1,
  process.env.IMGBB_API_KEY_2,
  process.env.IMGBB_API_KEY_3,
].filter((key) => key);

async function uploadToImgBB(file) {
  try {
    const dimensions = sizeOf(file.buffer);
    if (dimensions.width < 512 || dimensions.height < 512) {
      throw new Error("Image must be at least 512x512 pixels");
    }

    for (const apiKey of imgbbApiKeys) {
      try {
        const formData = new FormData();
        formData.append("image", file.buffer.toString("base64"));
        formData.append("key", apiKey);

        const response = await axios.post(
          "https://api.imgbb.com/1/upload",
          formData,
          {
            headers: formData.getHeaders(),
            timeout: 10000,
          }
        );

        if (response.data.success) {
          return {
            url: response.data.data.url,
            delete_url: response.data.data.delete_url,
          };
        }
      } catch (err) {
        console.error(
          `ImgBB upload failed with key ${apiKey.slice(0, 4)}...:`,
          err.response?.data || err.message
        );
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
    console.error("ImgBB delete failed:", err.response?.data || err.message);
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
    (accessToken, refreshToken, profile, done) => {
      console.log("Google auth callback:", {
        googleId: profile.id,
        email: profile.emails[0].value,
        displayName: profile.displayName,
      });
      const db = loadDB();
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
        saveDB(db);
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

passport.deserializeUser((id, done) => {
  console.log("Deserializing user ID:", id);
  const db = loadDB();
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
});

app.use((req, res, next) => {
  console.log("Session ID:", req.sessionID);
  req.upload = upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "previewImages", maxCount: 8 },
  ]);
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
  next();
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
const serveDatabase = (req, res) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).render("error", {
      message: "Access denied: Admin privileges required",
      user: req.user,
      query: req.query || {},
    });
  }
  try {
    const dbData = fs.readFileSync(dbPath, "utf8");
    res.setHeader("Content-Type", "application/json");
    res.send(dbData);
  } catch (err) {
    console.error("Error reading database.json:", {
      error: err.message,
      stack: err.stack,
    });
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
  console.log(`Server running on http://localhost:${PORT}`);
});