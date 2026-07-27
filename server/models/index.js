const mongoose = require('mongoose');
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'staff'], default: 'staff' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const GradeSchema = new Schema({
  name: { type: String, required: true, unique: true, trim: true },
  sortOrder: { type: Number, default: 0 },
});

const ProductSchema = new Schema({
  model: { type: String, required: true, trim: true },
  storage: { type: String, default: '', trim: true },
  sortOrder: { type: Number, default: 0 },
  // counts: { "<gradeId>": qty } — quantities per grade
  counts: { type: Map, of: Number, default: {} },
}, { timestamps: true });
ProductSchema.index({ model: 1, storage: 1 }, { unique: true });
ProductSchema.virtual('displayName').get(function () {
  return `${this.model} ${this.storage}`.trim();
});

const SaleSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product' },
  productName: { type: String, required: true },  // snapshot, survives deletes
  gradeName: { type: String, required: true },
  qty: { type: Number, required: true, min: 1 },
  username: { type: String, default: '' },
}, { timestamps: true });
SaleSchema.index({ createdAt: -1 });

const StockMovementSchema = new Schema({
  productName: { type: String, required: true },
  gradeName: { type: String, required: true },
  change: { type: Number, required: true },              // +5 / -2
  reason: { type: String, required: true },              // adjust | sale | sale_reverted | initial
  username: { type: String, default: '' },
}, { timestamps: true });
StockMovementSchema.index({ createdAt: -1 });

module.exports = {
  User: mongoose.models.User || mongoose.model('User', UserSchema),
  Grade: mongoose.models.Grade || mongoose.model('Grade', GradeSchema),
  Product: mongoose.models.Product || mongoose.model('Product', ProductSchema),
  Sale: mongoose.models.Sale || mongoose.model('Sale', SaleSchema),
  StockMovement: mongoose.models.StockMovement || mongoose.model('StockMovement', StockMovementSchema),
};
