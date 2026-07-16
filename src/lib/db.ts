import mongoose from 'mongoose';
import { runTenantMigration } from './migration';

export async function connectDB() {
  try {
    const mongoURI = process.env.DATABASE_URL || process.env.MONGO_URI;
    if (!mongoURI) {
      throw new Error('Database connection string is missing in environment variables (DATABASE_URL or MONGO_URI)');
    }

    mongoose.set('strictQuery', false);
    await mongoose.connect(mongoURI);
    console.log('🔌 Connected to MongoDB successfully via Mongoose');
    
    // Run schema migrations for multi-tenant SaaS transformation
    await runTenantMigration();
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

export default mongoose.connection;
