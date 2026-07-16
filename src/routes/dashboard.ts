import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { Transaction, CreditRecord, Product, TransactionItem } from '../models';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgoDate(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /api/v1/dashboard/stats
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const today = startOfToday();
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);

    const [todaySalesAgg, todayCount, creditSumAgg, yesterdaySalesAgg] = await Promise.all([
      Transaction.aggregate([
        { $match: { createdAt: { $gte: today, $lt: tomorrow }, status: { $ne: 'CREDIT' }, businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      Transaction.countDocuments({ createdAt: { $gte: today, $lt: tomorrow }, businessId: req.user!.businessId }),
      CreditRecord.aggregate([
        { $match: { businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
        { $group: { _id: null, amount: { $sum: '$amount' }, paid: { $sum: '$paid' } } }
      ]),
      Transaction.aggregate([
        { $match: { createdAt: { $gte: yesterday, $lt: today }, status: { $ne: 'CREDIT' }, businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
    ]);

    const todaySales = todaySalesAgg[0]?.total ?? 0;
    const yesterdaySales = yesterdaySalesAgg[0]?.total ?? 0;
    const totalCreditAmount = creditSumAgg[0]?.amount ?? 0;
    const totalPaid = creditSumAgg[0]?.paid ?? 0;
    const outstandingCredit = totalCreditAmount - totalPaid;

    let salesChange = '0% from yesterday';
    if (yesterdaySales > 0) {
      const diff = ((todaySales - yesterdaySales) / yesterdaySales) * 100;
      const sign = diff >= 0 ? '+' : '';
      salesChange = `${sign}${diff.toFixed(1)}% from yesterday`;
    } else if (todaySales > 0) {
      salesChange = '+100.0% from yesterday';
    }

    const lowStockProducts = await Product.find({
      businessId: req.user!.businessId,
      $expr: { $lte: ['$stock', '$minStock'] }
    }).select('_id');

    res.json({
      todaySales,
      todayTransactions: todayCount,
      outstandingCredit,
      lowStockCount: lowStockProducts.length,
      salesChange,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/dashboard/sales-chart
router.get('/sales-chart', async (req: AuthRequest, res: Response) => {
  try {
    const result = [];

    for (let i = 6; i >= 0; i--) {
      const start = daysAgoDate(i);
      const end = new Date(start); end.setDate(end.getDate() + 1);

      const agg = await Transaction.aggregate([
        { $match: { createdAt: { $gte: start, $lt: end }, status: { $ne: 'CREDIT' }, businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]);

      const dayOfWeek = start.getDay(); // 0=Sun
      const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayOfWeek];
      result.push({ day: dayName, revenue: agg[0]?.total ?? 0 });
    }

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/dashboard/payment-breakdown
router.get('/payment-breakdown', async (req: AuthRequest, res: Response) => {
  try {
    const methods = ['CASH', 'CARD', 'TRANSFER', 'CREDIT'];
    const breakdown = await Promise.all(
      methods.map(async (method) => {
        const count = await Transaction.countDocuments({ paymentMethod: method, businessId: req.user!.businessId });
        const agg = await Transaction.aggregate([
          { $match: { paymentMethod: method, businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
          { $group: { _id: null, total: { $sum: '$total' } } }
        ]);
        const total = agg[0]?.total ?? 0;
        return { method, count, total };
      })
    );
    res.json(breakdown);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/dashboard/top-products
router.get('/top-products', async (req: AuthRequest, res: Response) => {
  try {
    const items = await TransactionItem.aggregate([
      {
        $lookup: {
          from: 'transactions',
          localField: 'transactionId',
          foreignField: '_id',
          as: 'transaction'
        }
      },
      { $unwind: '$transaction' },
      { $match: { 'transaction.businessId': new mongoose.Types.ObjectId(req.user!.businessId) } },
      {
        $group: {
          _id: '$productId',
          qty: { $sum: '$qty' },
          sumPrice: { $sum: '$price' },
        }
      },
      { $sort: { qty: -1 } },
      { $limit: 5 }
    ]);

    const enriched = await Promise.all(
      items.map(async (item) => {
        const product = await Product.findById(item._id)
          .populate('category')
          .select('name categoryId');
        return {
          productId: item._id.toString(),
          name: product?.name ?? 'Unknown',
          category: (product as any)?.category?.name ?? '',
          qtySold: item.qty ?? 0,
          revenue: item.sumPrice ?? 0,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/dashboard/recent-sales
router.get('/recent-sales', async (req: AuthRequest, res: Response) => {
  try {
    const salesDocs = await Transaction.find({ businessId: req.user!.businessId })
      .sort({ createdAt: -1 })
      .limit(6)
      .populate('customer', 'name')
      .populate('staff', 'name');
    
    const sales = salesDocs.map((s) => s.toJSON());
    res.json(sales);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
