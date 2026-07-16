import { User, BusinessProfile, Category, Product, Customer, Transaction, CreditRecord, Payment, StockMovement } from '../models';

export async function runTenantMigration() {
  try {
    console.log('🔄 Running Multi-Tenant Schema Migration...');
    
    // 1. Get or create a default BusinessProfile
    let defaultBusiness = await BusinessProfile.findOne();
    if (!defaultBusiness) {
      defaultBusiness = await BusinessProfile.create({
        name: 'CoMag Inventory',
        slug: 'comag-inventory',
        currency: '$',
        enableCostTracking: true,
        vatRate: 7.5,
      });
      console.log(`✨ Created default Business Profile: ${defaultBusiness.name}`);
    } else if (!defaultBusiness.slug) {
      defaultBusiness.slug = 'comag-inventory';
      await defaultBusiness.save();
      console.log(`🏷️ Set slug on default Business Profile: ${defaultBusiness.slug}`);
    }

    const defaultBusinessId = defaultBusiness._id;

    // 2. Migrate Users
    const usersResult = await User.updateMany(
      { businessId: { $exists: false } },
      { $set: { businessId: defaultBusinessId } }
    );
    if (usersResult.modifiedCount > 0) {
      console.log(`👥 Migrated ${usersResult.modifiedCount} Users to default business.`);
    }

    // 3. Migrate Categories
    const categoriesResult = await Category.updateMany(
      { businessId: { $exists: false } },
      { $set: { businessId: defaultBusinessId } }
    );
    if (categoriesResult.modifiedCount > 0) {
      console.log(`🏷️ Migrated ${categoriesResult.modifiedCount} Categories to default business.`);
    }
    
    // 4. Migrate Products
    const productsResult = await Product.updateMany(
      { businessId: { $exists: false } },
      { $set: { businessId: defaultBusinessId } }
    );
    if (productsResult.modifiedCount > 0) {
      console.log(`📦 Migrated ${productsResult.modifiedCount} Products to default business.`);
    }

    // 5. Migrate Customers
    const customersResult = await Customer.updateMany(
      { businessId: { $exists: false } },
      { $set: { businessId: defaultBusinessId } }
    );
    if (customersResult.modifiedCount > 0) {
      console.log(`👤 Migrated ${customersResult.modifiedCount} Customers to default business.`);
    }

    // 6. Migrate Transactions
    const txResult = await Transaction.updateMany(
      { businessId: { $exists: false } },
      { $set: { businessId: defaultBusinessId } }
    );
    if (txResult.modifiedCount > 0) {
      console.log(`🧾 Migrated ${txResult.modifiedCount} Transactions to default business.`);
    }

    // 7. Migrate Credit Records
    const creditResult = await CreditRecord.updateMany(
      { businessId: { $exists: false } },
      { $set: { businessId: defaultBusinessId } }
    );
    if (creditResult.modifiedCount > 0) {
      console.log(`💳 Migrated ${creditResult.modifiedCount} Credit Records to default business.`);
    }

    // 8. Migrate Payments
    const paymentsResult = await Payment.updateMany(
      { businessId: { $exists: false } },
      { $set: { businessId: defaultBusinessId } }
    );
    if (paymentsResult.modifiedCount > 0) {
      console.log(`💰 Migrated ${paymentsResult.modifiedCount} Payments to default business.`);
    }

    // 9. Migrate Stock Movements
    const movementsResult = await StockMovement.updateMany(
      { businessId: { $exists: false } },
      { $set: { businessId: defaultBusinessId } }
    );
    if (movementsResult.modifiedCount > 0) {
      console.log(`🚛 Migrated ${movementsResult.modifiedCount} Stock Movements to default business.`);
    }

    console.log('✅ Multi-Tenant Schema Migration completed successfully.');
  } catch (error) {
    console.error('❌ Multi-Tenant Schema Migration failed:', error);
  }
}
