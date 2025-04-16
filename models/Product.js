const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  discountPrice: { type: Number },
  discountExpiry: { type: Date },
  origin: { type: String },
  thumbnail: { type: String },
  previewImages: [{ type: String }],
  details: [{ key: String, value: String }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', productSchema);