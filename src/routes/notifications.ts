import { Router, Response } from 'express';
import { Notification, Product, Customer, Transaction, CreditRecord } from '../models';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

// GET /api/v1/notifications — paginated list
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const query: any = { userId: req.user!.id };
    if (req.query.unreadOnly === 'true') query.read = false;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(query),
      Notification.countDocuments({ userId: req.user!.id, read: false }),
    ]);

    res.json({
      data: notifications,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      unreadCount,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/notifications/unread-count
router.get('/unread-count', async (req: AuthRequest, res: Response) => {
  try {
    const unreadCount = await Notification.countDocuments({ userId: req.user!.id, read: false });
    res.json({ unreadCount });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/v1/notifications/read-all
router.put('/read-all', async (req: AuthRequest, res: Response) => {
  try {
    await Notification.updateMany({ userId: req.user!.id, read: false }, { read: true });
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/v1/notifications/:id/read
router.put('/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { read: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ message: 'Notification not found' }) as any;
    res.json(notification);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/v1/notifications
router.delete('/', async (req: AuthRequest, res: Response) => {
  try {
    await Notification.deleteMany({ userId: req.user!.id });
    res.json({ message: 'All notifications cleared' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/v1/notifications/generate — generate notifications from current data
router.post('/generate', async (req: AuthRequest, res: Response) => {
  try {
    const businessId = req.user!.businessId;
    const userId = req.user!.id;
    const now = new Date();
    const created: any[] = [];

    // 1. Low-stock alerts — only one per product per day
    const lowStockProducts = await Product.find({
      businessId,
      $expr: { $lte: ['$stock', '$minStock'] },
    });

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    for (const product of lowStockProducts) {
      const existingToday = await Notification.findOne({
        userId,
        type: 'low_stock',
        createdAt: { $gte: startOfToday },
        message: { $regex: product.name, $options: 'i' },
      });
      if (!existingToday) {
        const doc = await Notification.create({
          userId,
          businessId,
          title: 'Low Stock Alert',
          message: `"${product.name}" is low on stock (${product.stock} left).`,
          type: 'low_stock',
          link: '/inventory',
        });
        created.push(doc);
      }
    }

    // 2. Credit due reminders — customers with unpaid credit > 0, one per customer per day
    const customersWithCredit = await Customer.find({
      businessId,
      totalCredit: { $gt: 0 },
    });

    for (const customer of customersWithCredit) {
      const existingToday = await Notification.findOne({
        userId,
        type: 'credit_due',
        createdAt: { $gte: startOfToday },
        message: { $regex: customer.name, $options: 'i' },
      });
      if (!existingToday) {
        const doc = await Notification.create({
          userId,
          businessId,
          title: 'Credit Due',
          message: `"${customer.name}" has ₦${customer.totalCredit.toLocaleString()} outstanding credit.`,
          type: 'credit_due',
          link: '/credit',
        });
        created.push(doc);
      }
    }

    // 3. Daily summary — one per day
    const existingSummaryToday = await Notification.findOne({
      userId,
      type: 'daily_summary',
      createdAt: { $gte: startOfToday },
    });

    if (!existingSummaryToday) {
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const [salesAgg, txCount, creditAgg] = await Promise.all([
        Transaction.aggregate([
          { $match: { createdAt: { $gte: today, $lt: tomorrow }, status: { $ne: 'CREDIT' }, businessId } },
          { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
        Transaction.countDocuments({ createdAt: { $gte: today, $lt: tomorrow }, businessId }),
        CreditRecord.aggregate([
          { $match: { businessId } },
          { $group: { _id: null, amount: { $sum: '$amount' }, paid: { $sum: '$paid' } } },
        ]),
      ]);

      const todaySales = salesAgg[0]?.total ?? 0;
      const outstandingCredit = (creditAgg[0]?.amount ?? 0) - (creditAgg[0]?.paid ?? 0);

      const doc = await Notification.create({
        userId,
        businessId,
        title: 'Daily Summary',
        message: `Today: ${txCount} sales, ₦${todaySales.toLocaleString()} revenue. Outstanding credit: ₦${outstandingCredit.toLocaleString()}.`,
        type: 'daily_summary',
        link: '/reports',
      });
      created.push(doc);
    }

    res.json({ message: 'Notifications generated', count: created.length, notifications: created });
  } catch (err) {
    console.error('Notification generation error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
