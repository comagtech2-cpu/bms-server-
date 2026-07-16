import 'dotenv/config';
import mongoose from 'mongoose';
import {
  StockMovement,
  Payment,
  CreditRecord,
  TransactionItem,
  Transaction,
  Product,
  Category,
  Customer,
  User,
  BusinessProfile,
} from '../src/models';

async function main() {
  console.log('🌱 Starting database clean wipe...');

  const mongoURI = process.env.DATABASE_URL || process.env.MONGO_URI;
  if (!mongoURI) {
    throw new Error('Database connection string is missing (DATABASE_URL or MONGO_URI)');
  }
  await mongoose.connect(mongoURI);

  console.log('🧹 Deleting Stock Movements...');
  await StockMovement.deleteMany({});

  console.log('🧹 Deleting Payments...');
  await Payment.deleteMany({});

  console.log('🧹 Deleting Credit Records...');
  await CreditRecord.deleteMany({});

  console.log('🧹 Deleting Transaction Items...');
  await TransactionItem.deleteMany({});

  console.log('🧹 Deleting Transactions...');
  await Transaction.deleteMany({});

  console.log('🧹 Deleting Products...');
  await Product.deleteMany({});

  console.log('🧹 Deleting Categories...');
  await Category.deleteMany({});

  console.log('🧹 Deleting Customers...');
  await Customer.deleteMany({});

  console.log('🧹 Deleting Users...');
  await User.deleteMany({});

  console.log('🧹 Deleting Business Profiles...');
  await BusinessProfile.deleteMany({});

  console.log('✨ database wiped successfully! You now have a clean slate.');
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (e) => {
    console.error('Error wiping database:', e);
    await mongoose.disconnect();
    process.exit(1);
  });
