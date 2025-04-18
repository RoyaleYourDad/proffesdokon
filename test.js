router.get("/test-product", (req, res) => {
    const db = loadDB();
    const product = db.products.find((p) => p.id === "1744739166453");
    res.render("product", {
      product,
      users: db.users,
      user: req.user,
      categories: db.categories,
      editReview: null,
      query: {},
    });
  });