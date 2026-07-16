import mongoose, { Schema, Document } from 'mongoose';

// ─── Soft Delete Plugin ──────────────────────────────────────────────────────
interface ISoftDelete {
  isDeleted: boolean;
  deletedAt?: Date;
  softDelete(): Promise<this>;
}

function applySoftDelete(schema: Schema) {
  schema.add({
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  });

  schema.methods.softDelete = async function (this: any) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    return this.save();
  };

  schema.pre('find', function () { this.where({ isDeleted: { $ne: true } }); });
  schema.pre('findOne', function () { this.where({ isDeleted: { $ne: true } }); });
  schema.pre('findOneAndUpdate', function () { this.where({ isDeleted: { $ne: true } }); });
  schema.pre('findOneAndDelete', function () { this.where({ isDeleted: { $ne: true } }); });
  schema.pre('countDocuments', function () { this.where({ isDeleted: { $ne: true } }); });
  schema.pre('aggregate', function () { this.pipeline().unshift({ $match: { isDeleted: { $ne: true } } }); });
}

// Global transformation helper for JSON and Object formats
const applyTransform = (schema: Schema) => {
  schema.set('toJSON', {
    virtuals: true,
    versionKey: false,
    transform: (doc, ret) => {
      if (ret._id) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
      return ret;
    },
  });
  schema.set('toObject', {
    virtuals: true,
    versionKey: false,
    transform: (doc, ret) => {
      if (ret._id) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
      return ret;
    },
  });
};

// 1. User
export interface IUser extends Document, ISoftDelete {
  name: string;
  email: string;
  password: string;
  role: string;
  businessId?: mongoose.Types.ObjectId;
  createdAt: Date;
}
const UserSchema = new Schema<IUser>({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'STAFF' },
  businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile' },
  createdAt: { type: Date, default: Date.now },
});
applyTransform(UserSchema);
applySoftDelete(UserSchema);
export const User = mongoose.model<IUser>('User', UserSchema);

// 2. BusinessProfile
export interface IBusinessProfile extends Document {
  name: string;
  slug?: string;
  logo?: string;
  phone?: string;
  address?: string;
  currency: string;
  tagline?: string;
  enableCostTracking?: boolean;
  vatRate?: number;
  isSuspended?: boolean;
  suspendedAt?: Date;
}
const BusinessProfileSchema = new Schema<IBusinessProfile>({
  name: { type: String, default: 'My Business' },
  slug: { type: String, unique: true, sparse: true },
  logo: { type: String },
  phone: { type: String },
  address: { type: String },
  currency: { type: String, default: '$' },
  tagline: { type: String },
  enableCostTracking: { type: Boolean, default: true },
  vatRate: { type: Number, default: 7.5 },
  isSuspended: { type: Boolean, default: false },
  suspendedAt: { type: Date, default: null },
});
applyTransform(BusinessProfileSchema);
export const BusinessProfile = mongoose.model<IBusinessProfile>('BusinessProfile', BusinessProfileSchema);

// 3. Category
export interface ICategory extends Document, ISoftDelete {
  name: string;
  color: string;
  icon?: string;
  businessId?: mongoose.Types.ObjectId;
}
const CategorySchema = new Schema<ICategory>({
  name: { type: String, required: true },
  color: { type: String, default: '#4f7cff' },
  icon: { type: String },
  businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
});
applyTransform(CategorySchema);
applySoftDelete(CategorySchema);
export const Category = mongoose.model<ICategory>('Category', CategorySchema);

// 4. Product
export interface IProduct extends Document, ISoftDelete {
  name: string;
  sku: string;
  price: number;
  cost: number;
  stock: number;
  minStock: number;
  categoryId: mongoose.Types.ObjectId;
  image?: string;
  businessId?: mongoose.Types.ObjectId;
  createdAt: Date;
}
const ProductSchema = new Schema<IProduct>({
  name: { type: String, required: true },
  sku: { type: String, required: true, unique: true },
  price: { type: Number, default: 0 },
  cost: { type: Number, default: 0 },
  stock: { type: Number, default: 0 },
  minStock: { type: Number, default: 5 },
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  image: { type: String },
  businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
  createdAt: { type: Date, default: Date.now },
});
applyTransform(ProductSchema);
applySoftDelete(ProductSchema);
// Add virtual relation for populate logic
ProductSchema.virtual('category', {
  ref: 'Category',
  localField: 'categoryId',
  foreignField: '_id',
  justOne: true,
});
export const Product = mongoose.model<IProduct>('Product', ProductSchema);

// 5. Customer
export interface ICustomer extends Document, ISoftDelete {
  name: string;
  phone?: string;
  email?: string;
  totalCredit: number;
  businessId?: mongoose.Types.ObjectId;
  createdAt: Date;
}
const CustomerSchema = new Schema<ICustomer>({
  name: { type: String, required: true },
  phone: { type: String },
  email: { type: String },
  totalCredit: { type: Number, default: 0 },
  businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
  createdAt: { type: Date, default: Date.now },
});
applyTransform(CustomerSchema);
applySoftDelete(CustomerSchema);
CustomerSchema.index({ businessId: 1, phone: 1 }, { unique: true, sparse: true });
CustomerSchema.index({ businessId: 1, email: 1 }, { unique: true, sparse: true });
export const Customer = mongoose.model<ICustomer>('Customer', CustomerSchema);

// 6. Transaction
export interface ITransaction extends Document, ISoftDelete {
  customerId?: mongoose.Types.ObjectId;
  guestName?: string;
  staffId?: mongoose.Types.ObjectId;
  total: number;
  amountPaid: number;
  change: number;
  paymentMethod: string;
  status: string;
  note?: string;
  businessId?: mongoose.Types.ObjectId;
  createdAt: Date;
}
const TransactionSchema = new Schema<ITransaction>({
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  guestName: { type: String },
  staffId: { type: Schema.Types.ObjectId, ref: 'User' },
  total: { type: Number, required: true },
  amountPaid: { type: Number, required: true },
  change: { type: Number, default: 0 },
  paymentMethod: { type: String, default: 'CASH' },
  status: { type: String, default: 'PAID' },
  note: { type: String },
  businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
  createdAt: { type: Date, default: Date.now },
});
applyTransform(TransactionSchema);
applySoftDelete(TransactionSchema);
// Add virtuals for relations
TransactionSchema.virtual('customer', {
  ref: 'Customer',
  localField: 'customerId',
  foreignField: '_id',
  justOne: true,
});
TransactionSchema.virtual('staff', {
  ref: 'User',
  localField: 'staffId',
  foreignField: '_id',
  justOne: true,
});
TransactionSchema.virtual('items', {
  ref: 'TransactionItem',
  localField: '_id',
  foreignField: 'transactionId',
});
TransactionSchema.virtual('creditRecord', {
  ref: 'CreditRecord',
  localField: '_id',
  foreignField: 'transactionId',
  justOne: true,
});
export const Transaction = mongoose.model<ITransaction>('Transaction', TransactionSchema);

// 7. TransactionItem
export interface ITransactionItem extends Document {
  transactionId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  qty: number;
  price: number;
}
const TransactionItemSchema = new Schema<ITransactionItem>({
  transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  qty: { type: Number, required: true },
  price: { type: Number, required: true },
});
applyTransform(TransactionItemSchema);
TransactionItemSchema.virtual('product', {
  ref: 'Product',
  localField: 'productId',
  foreignField: '_id',
  justOne: true,
});
export const TransactionItem = mongoose.model<ITransactionItem>('TransactionItem', TransactionItemSchema);

// 8. CreditRecord
export interface ICreditRecord extends Document {
  customerId: mongoose.Types.ObjectId;
  transactionId: mongoose.Types.ObjectId;
  amount: number;
  paid: number;
  dueDate?: Date;
  businessId?: mongoose.Types.ObjectId;
  createdAt: Date;
}
const CreditRecordSchema = new Schema<ICreditRecord>({
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true, unique: true },
  amount: { type: Number, required: true },
  paid: { type: Number, default: 0 },
  dueDate: { type: Date },
  businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
  createdAt: { type: Date, default: Date.now },
});
applyTransform(CreditRecordSchema);
CreditRecordSchema.virtual('customer', {
  ref: 'Customer',
  localField: 'customerId',
  foreignField: '_id',
  justOne: true,
});
CreditRecordSchema.virtual('transaction', {
  ref: 'Transaction',
  localField: 'transactionId',
  foreignField: '_id',
  justOne: true,
});
CreditRecordSchema.virtual('payments', {
  ref: 'Payment',
  localField: '_id',
  foreignField: 'creditRecordId',
});
export const CreditRecord = mongoose.model<ICreditRecord>('CreditRecord', CreditRecordSchema);

// 9. Payment
export interface IPayment extends Document {
  creditRecordId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  amount: number;
  method: string;
  note?: string;
  businessId?: mongoose.Types.ObjectId;
  createdAt: Date;
}
const PaymentSchema = new Schema<IPayment>({
  creditRecordId: { type: Schema.Types.ObjectId, ref: 'CreditRecord', required: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  amount: { type: Number, required: true },
  method: { type: String, default: 'CASH' },
  note: { type: String },
  businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
  createdAt: { type: Date, default: Date.now },
});
applyTransform(PaymentSchema);
PaymentSchema.virtual('creditRecord', {
  ref: 'CreditRecord',
  localField: 'creditRecordId',
  foreignField: '_id',
  justOne: true,
});
PaymentSchema.virtual('customer', {
  ref: 'Customer',
  localField: 'customerId',
  foreignField: '_id',
  justOne: true,
});
export const Payment = mongoose.model<IPayment>('Payment', PaymentSchema);

// 10. StockMovement
export interface IStockMovement extends Document {
  productId: mongoose.Types.ObjectId;
  type: string;
  qty: number;
  note?: string;
  businessId?: mongoose.Types.ObjectId;
  createdAt: Date;
}
const StockMovementSchema = new Schema<IStockMovement>({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  type: { type: String, required: true },
  qty: { type: Number, required: true },
  note: { type: String },
  businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
  createdAt: { type: Date, default: Date.now },
});
applyTransform(StockMovementSchema);
StockMovementSchema.virtual('product', {
  ref: 'Product',
  localField: 'productId',
  foreignField: '_id',
  justOne: true,
});
export const StockMovement = mongoose.model<IStockMovement>('StockMovement', StockMovementSchema);

// 11. AuditLog
export interface IAuditLog extends Document {
  userId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  entityId?: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
  ip?: string;
  createdAt: Date;
}
const AuditLogSchema = new Schema<IAuditLog>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
  action: { type: String, enum: ['CREATE', 'UPDATE', 'DELETE'], required: true },
  entity: { type: String, required: true },
  entityId: { type: String },
  before: { type: Schema.Types.Mixed },
  after: { type: Schema.Types.Mixed },
  ip: { type: String },
  createdAt: { type: Date, default: Date.now },
});
applyTransform(AuditLogSchema);
AuditLogSchema.index({ businessId: 1, createdAt: -1 });
AuditLogSchema.index({ businessId: 1, entity: 1, createdAt: -1 });
export const AuditLog = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);

// 12. Notification
export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  title: string;
  message: string;
  type: 'low_stock' | 'credit_due' | 'daily_summary' | 'info';
  link?: string;
  read: boolean;
  createdAt: Date;
}
const NotificationSchema = new Schema<INotification>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['low_stock', 'credit_due', 'daily_summary', 'info'], required: true },
  link: { type: String },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
applyTransform(NotificationSchema);
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, read: 1 });
export const Notification = mongoose.model<INotification>('Notification', NotificationSchema);
