import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User, BusinessProfile, Category, Product } from '../src/models';

async function main() {
  console.log('🌱 Starting database seeding...');

  const mongoURI = process.env.DATABASE_URL || process.env.MONGO_URI;
  if (!mongoURI) {
    throw new Error('Database connection string is missing (DATABASE_URL or MONGO_URI)');
  }
  await mongoose.connect(mongoURI);

  // 1. Seed Business Profile
  let profile = await BusinessProfile.findOne();
  if (!profile) {
    profile = await BusinessProfile.create({
      name: 'BMS Store',
      currency: '$',
      phone: '123-456-7890',
      address: '123 Main St, New York, NY',
      tagline: 'Your one-stop business shop',
    });
    console.log('✅ Created default business profile.');
  }

  // 2. Seed Owner User
  const ownerEmail = 'admin@bms.com';
  let owner = await User.findOne({ email: ownerEmail });
  if (!owner) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    owner = await User.create({
      name: 'Owner Admin',
      email: ownerEmail,
      password: hashedPassword,
      role: 'OWNER',
    });
    console.log('✅ Created default owner user (admin@bms.com / admin123).');
  }

  // 3. Seed Categories and Products
  let category = await Category.findOne({ name: 'General' });
  if (!category) {
    category = await Category.create({
      name: 'General',
      color: '#4f7cff',
      icon: 'box',
    });
    console.log('✅ Created General category.');
  }

  const productSku = 'GEN-PROD-01';
  const product = await Product.findOne({ sku: productSku });
  if (!product) {
    await Product.create({
      name: 'Sample Product',
      sku: productSku,
      price: 10.0,
      cost: 5.0,
      stock: 50,
      minStock: 5,
      categoryId: category._id as mongoose.Types.ObjectId,
      image: '',
    });
    console.log('✅ Created sample product.');
  }

  console.log('✨ Seeding completed successfully!');
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (e) => {
    console.error('Error seeding database:', e);
    await mongoose.disconnect();
    process.exit(1);
  });
