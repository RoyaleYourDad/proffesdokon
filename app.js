const express = require("express");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");

dotenv.config();

const app = express();
const dbPath = path.join(__dirname, "database.json");

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images are allowed"), false);
  },
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/uploads", express.static("public/uploads"));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  })
);
app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  req.upload = upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "previewImages", maxCount: 10 },
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

const loadDB = () => {
  try {
    const data = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    data.users = data.users.map((user) => ({
      ...user,
      role: user.role || "user",
      cart: user.cart || [],
      cartCount: user.cartCount || 0,
      isAdmin: user.role === "admin",
    }));
    return data;
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

const imgbbApiKeys = [
  process.env.IMGBB_API_KEY_1,
  process.env.IMGBB_API_KEY_2,
  process.env.IMGBB_API_KEY_3,
].filter((key) => key);

async function uploadToImgBB(file) {
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
}

async function deleteFromImgBB(deleteUrl) {
  try {
    await axios.get(deleteUrl);
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
      callbackURL: "http://localhost:3000/auth/google/callback",
    },
    (accessToken, refreshToken, profile, done) => {
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
        };
        db.users.push(user);
        saveDB(db);
      }

      user.isAdmin = user.role === "admin";
      console.log("Google auth user:", {
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
    console.log("Deserialize failed: User not found", id);
    done(null, null);
  }
});

app.locals.uploadToImgBB = uploadToImgBB;
app.locals.deleteFromImgBB = deleteFromImgBB;

// Routes
app.use("/", require("./routes/index"));
app.use("/admin", require("./routes/admin"));
app.use("/auth", require("./routes/auth"));
app.use("/cart", require("./routes/cart"));
let db = {};
try {
  db = JSON.parse(fs.readFileSync(path.join(__dirname, 'database.json')));
} catch (err) {
  console.error('Error loading database.json:', err);
}

// Serve database.json
app.get('/database.json', (req, res) => {
  const filePath = path.join(__dirname, 'database.json');
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).json({ error: 'File not found' });
    }
  });
});
app.use((err, req, res, next) => {
  console.error("Server error:", err.stack);
  res.status(500).send("Something went wrong!");
});
app.get('/', (req, res) => {
  const { category, priceMin, priceMax, sort, search } = req.query;

  // Get products from database.json
  let products = db.products || [];

  // Apply search filter
  if (search) {
    const searchLower = search.toLowerCase();
    products = products.filter(p =>
      p.name.toLowerCase().includes(searchLower) ||
      (p.category && p.category.toLowerCase().includes(searchLower))
    );
  }

  // Apply category filter
  if (category && category !== '') {
    products = products.filter(p => p.category === category);
  }

  // Apply price filter
  const minPrice = parseFloat(priceMin) || 0;
  const maxPrice = parseFloat(priceMax) || Infinity;
  products = products.filter(p => {
    const price = p.discountPrice && (!p.discountExpiry || new Date(p.discountExpiry) > new Date())
      ? p.discountPrice
      : p.price;
    return price >= minPrice && price <= maxPrice;
  });

  // Apply sort
  switch (sort) {
    case 'price-asc':
      products.sort((a, b) => {
        const aPrice = a.discountPrice && (!a.discountExpiry || new Date(a.discountExpiry) > new Date()) ? a.discountPrice : a.price;
        const bPrice = b.discountPrice && (!b.discountExpiry || new Date(b.discountExpiry) > new Date()) ? b.discountPrice : b.price;
        return aPrice - bPrice;
      });
      break;
    case 'price-desc':
      products.sort((a, b) => {
        const aPrice = a.discountPrice && (!a.discountExpiry || new Date(a.discountExpiry) > new Date()) ? a.discountPrice : a.price;
        const bPrice = b.discountPrice && (!b.discountExpiry || new Date(b.discountExpiry) > new Date()) ? b.discountPrice : b.price;
        return bPrice - aPrice;
      });
      break;
    case 'name-asc':
      products.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'rating-desc':
      products.sort((a, b) => {
        const aRating = a.reviews && a.reviews.length ? a.reviews.reduce((sum, r) => sum + r.rating, 0) / a.reviews.length : 0;
        const bRating = b.reviews && b.reviews.length ? b.reviews.reduce((sum, r) => sum + r.rating, 0) / b.reviews.length : 0;
        return bRating - aRating;
      });
      break;
    default:
      // Default sort (e.g., by ID or no sort)
      break;
  }

  // Get unique categories
  const categories = [...new Set(db.products.map(p => p.category).filter(c => c))];

  // Render index.ejs
  res.render('index', {
    products,
    categories,
    query: req.query,
    user: req.user || null,
    error: products.length === 0 ? 'No products match your filters.' : null
  });
});
app.get('/database.json', (req, res) => {
  const filePath = path.join(__dirname, 'database.json');
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).json({ error: 'File not found' });
    }
  });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});