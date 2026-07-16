import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import {
  BusinessProfile,
  User,
  Product,
  Transaction,
  TransactionItem,
  Customer,
  CreditRecord,
  Payment,
  StockMovement,
  AuditLog,
  Category,
  Notification,
} from '../models';

const router = Router();

// ─── Admin Key Middleware ─────────────────────────────────────────────────────
// Protect all admin routes with a simple key from .env
const adminAuth = (req: Request, res: Response, next: NextFunction): void => {
  const key = req.headers['x-admin-key'] as string;
  const adminKey = process.env.ADMIN_KEY || 'bms-super-admin-2024';
  if (!key || key !== adminKey) {
    res.status(401).json({ message: 'Unauthorized – invalid admin key' });
    return;
  }
  next();
};

router.use(adminAuth);

// ─── GET /api/admin/overview ──────────────────────────────────────────────────
// Platform-wide stats
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalBusinesses,
      suspendedBusinesses,
      totalUsers,
      totalProducts,
      totalTransactions,
      totalCustomers,
      revenueAgg,
      todayRevenueAgg,
      newBusinesses30d,
      newUsers30d,
    ] = await Promise.all([
      BusinessProfile.countDocuments(),
      BusinessProfile.countDocuments({ isSuspended: true }),
      User.countDocuments(),
      Product.countDocuments(),
      Transaction.countDocuments(),
      Customer.countDocuments(),
      Transaction.aggregate([
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      Transaction.aggregate([
        { $match: { createdAt: { $gte: today } } },
        { $group: { _id: null, total: { $sum: '$total' } } },
      ]),
      BusinessProfile.countDocuments({ _id: { $gt: mongoose.Types.ObjectId.createFromTime(thirtyDaysAgo.getTime() / 1000) } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    ]);

    res.json({
      totalBusinesses,
      suspendedBusinesses,
      totalUsers,
      totalProducts,
      totalTransactions,
      totalCustomers,
      totalRevenue: revenueAgg[0]?.total ?? 0,
      todayRevenue: todayRevenueAgg[0]?.total ?? 0,
      newBusinesses30d,
      newUsers30d,
    });
  } catch (err) {
    console.error('[Admin Overview]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/admin/businesses ────────────────────────────────────────────────
// List all businesses with activity summaries
router.get('/businesses', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    const query: any = {};
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.name = { $regex: safe, $options: 'i' };
    }

    const [businesses, total] = await Promise.all([
      BusinessProfile.find(query).sort({ _id: -1 }).skip(skip).limit(limit).lean(),
      BusinessProfile.countDocuments(query),
    ]);

    // Enrich each business with activity counts
    const enriched = await Promise.all(
      businesses.map(async (biz: any) => {
        const bizId = biz._id;
        const [userCount, productCount, transactionCount, customerCount, revenueAgg] =
          await Promise.all([
            User.countDocuments({ businessId: bizId }),
            Product.countDocuments({ businessId: bizId }),
            Transaction.countDocuments({ businessId: bizId }),
            Customer.countDocuments({ businessId: bizId }),
            Transaction.aggregate([
              { $match: { businessId: bizId } },
              { $group: { _id: null, total: { $sum: '$total' } } },
            ]),
          ]);

        return {
          id: bizId.toString(),
          name: biz.name,
          slug: biz.slug,
          logo: biz.logo,
          phone: biz.phone,
          currency: biz.currency,
          vatRate: biz.vatRate,
          isSuspended: biz.isSuspended || false,
          suspendedAt: biz.suspendedAt,
          users: userCount,
          products: productCount,
          transactions: transactionCount,
          customers: customerCount,
          revenue: revenueAgg[0]?.total ?? 0,
        };
      })
    );

    res.json({ data: enriched, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Admin Businesses]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/admin/businesses/:id ────────────────────────────────────────────
// Detailed view for a single business
router.get('/businesses/:id', async (req: Request, res: Response) => {
  try {
    const bizId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(bizId)) {
      return res.status(400).json({ message: 'Invalid business ID' }) as any;
    }

    const business = await BusinessProfile.findById(bizId).lean();
    if (!business) return res.status(404).json({ message: 'Business not found' }) as any;

    const bizObjId = new mongoose.Types.ObjectId(bizId);

    const [users, products, categories, recentTransactions, creditAgg, revenueByDay] =
      await Promise.all([
        User.find({ businessId: bizId })
          .select('name email role createdAt')
          .sort({ createdAt: -1 })
          .lean(),
        Product.find({ businessId: bizId })
          .populate('category', 'name color')
          .sort({ name: 'asc' })
          .limit(50)
          .lean(),
        Category.countDocuments({ businessId: bizId }),
        Transaction.find({ businessId: bizId })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('customer', 'name')
          .populate('staff', 'name')
          .lean(),
        CreditRecord.aggregate([
          { $match: { businessId: bizObjId } },
          { $group: { _id: null, amount: { $sum: '$amount' }, paid: { $sum: '$paid' } } },
        ]),
        Transaction.aggregate([
          { $match: { businessId: bizObjId } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              total: { $sum: '$total' },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: -1 } },
          { $limit: 14 },
        ]),
      ]);

    res.json({
      business,
      users,
      products: products.map((p: any) => ({
        ...p,
        id: p._id?.toString(),
      })),
      categories,
      recentTransactions: recentTransactions.map((t: any) => ({
        ...t,
        id: t._id?.toString(),
      })),
      credit: {
        totalOwed: (creditAgg[0]?.amount ?? 0) - (creditAgg[0]?.paid ?? 0),
        totalAmount: creditAgg[0]?.amount ?? 0,
        totalPaid: creditAgg[0]?.paid ?? 0,
      },
      revenueByDay: revenueByDay.reverse(),
    });
  } catch (err) {
    console.error('[Admin Business Detail]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── PATCH /api/admin/businesses/:id/suspend ──────────────────────────────────
// Toggle suspend / unsuspend a business
router.patch('/businesses/:id/suspend', async (req: Request, res: Response) => {
  try {
    const bizId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(bizId)) {
      return res.status(400).json({ message: 'Invalid business ID' }) as any;
    }

    const business = await BusinessProfile.findById(bizId);
    if (!business) return res.status(404).json({ message: 'Business not found' }) as any;

    const newStatus = !business.isSuspended;
    business.isSuspended = newStatus;
    business.suspendedAt = newStatus ? new Date() : undefined;
    await business.save();

    console.log(`[Admin] Business "${business.name}" ${newStatus ? 'SUSPENDED' : 'UNSUSPENDED'}`);

    res.json({
      message: `Business "${business.name}" has been ${newStatus ? 'suspended' : 'unsuspended'}.`,
      isSuspended: newStatus,
    });
  } catch (err) {
    console.error('[Admin Suspend]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── DELETE /api/admin/businesses/:id ─────────────────────────────────────────
// Hard delete a business and cascade-delete ALL associated data
router.delete('/businesses/:id', async (req: Request, res: Response) => {
  try {
    const bizId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(bizId)) {
      return res.status(400).json({ message: 'Invalid business ID' }) as any;
    }

    const business = await BusinessProfile.findById(bizId);
    if (!business) return res.status(404).json({ message: 'Business not found' }) as any;

    const bizObjId = new mongoose.Types.ObjectId(bizId);

    // Get all transaction IDs for this business (needed for TransactionItems)
    const transactionIds = await Transaction.find({ businessId: bizId }).distinct('_id');

    // Get all credit record IDs (needed for Payments)
    const creditRecordIds = await CreditRecord.find({ businessId: bizId }).distinct('_id');

    // Cascade delete all associated data in parallel
    const results = await Promise.allSettled([
      // TransactionItems linked to this business's transactions
      TransactionItem.deleteMany({ transactionId: { $in: transactionIds } }),
      // Payments linked to this business's credit records
      Payment.deleteMany({ creditRecordId: { $in: creditRecordIds } }),
      // Direct businessId references
      CreditRecord.deleteMany({ businessId: bizId }),
      Transaction.deleteMany({ businessId: bizId }),
      Product.deleteMany({ businessId: bizId }),
      Customer.deleteMany({ businessId: bizId }),
      Category.deleteMany({ businessId: bizId }),
      StockMovement.deleteMany({ businessId: bizId }),
      AuditLog.deleteMany({ businessId: bizObjId }),
      Notification.deleteMany({ businessId: bizObjId }),
      User.deleteMany({ businessId: bizId }),
    ]);

    // Count what was deleted
    const counts: Record<string, number> = {};
    const labels = [
      'transactionItems', 'payments', 'creditRecords', 'transactions',
      'products', 'customers', 'categories', 'stockMovements',
      'auditLogs', 'notifications', 'users',
    ];
    results.forEach((r, i) => {
      counts[labels[i]] = r.status === 'fulfilled' ? (r.value as any).deletedCount ?? 0 : 0;
    });

    // Finally, delete the business profile itself
    await BusinessProfile.findByIdAndDelete(bizId);

    console.log(`[Admin] HARD DELETED business "${business.name}" (${bizId}):`, counts);

    res.json({
      message: `Business "${business.name}" and all associated data have been permanently deleted.`,
      deleted: counts,
    });
  } catch (err) {
    console.error('[Admin Delete Business]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/admin/activity ──────────────────────────────────────────────────
// Recent activity feed across all businesses
router.get('/activity', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit as string) || 30);

    const logs = await AuditLog.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', 'name email')
      .lean();

    const enriched = logs.map((log: any) => ({
      id: log._id?.toString(),
      user: log.userId?.name || 'Unknown',
      email: log.userId?.email || '',
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      businessId: log.businessId?.toString(),
      ip: log.ip,
      createdAt: log.createdAt,
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[Admin Activity]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
// List all users across all businesses
router.get('/users', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find()
        .select('name email role businessId createdAt')
        .populate('businessId', 'name slug isSuspended')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(),
    ]);

    const data = users.map((u: any) => ({
      id: u._id?.toString(),
      name: u.name,
      email: u.email,
      role: u.role,
      businessName: u.businessId?.name || 'N/A',
      businessSlug: u.businessId?.slug || '',
      businessSuspended: u.businessId?.isSuspended || false,
      createdAt: u.createdAt,
    }));

    res.json({ data, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[Admin Users]', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
