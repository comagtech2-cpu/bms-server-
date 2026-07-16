import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { Transaction, CreditRecord, TransactionItem, Category, Product, User } from '../models';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

function daysAgoDate(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /api/v1/reports/sales
router.get('/sales', async (req: AuthRequest, res: Response) => {
  try {
    const { period = 'daily', days = '30' } = req.query;
    const result = [];
    const numDays = Number(days);

    for (let i = numDays - 1; i >= 0; i--) {
      const start = daysAgoDate(i);
      const end = new Date(start); end.setDate(end.getDate() + 1);

      const agg = await Transaction.aggregate([
        { $match: { createdAt: { $gte: start, $lt: end }, status: { $ne: 'CREDIT' }, businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } }
      ]);

      const revenue = agg[0]?.total ?? 0;
      const transactions = agg[0]?.count ?? 0;

      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      result.push({
        date: start.toISOString().split('T')[0],
        day: dayNames[start.getDay()],
        revenue,
        transactions,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/reports/cashflow
router.get('/cashflow', async (req: AuthRequest, res: Response) => {
  try {
    const [revenueAgg, creditAgg] = await Promise.all([
      Transaction.aggregate([
        { $match: { status: { $ne: 'CREDIT' }, businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]),
      CreditRecord.aggregate([
        { $match: { businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
        { $group: { _id: null, amount: { $sum: '$amount' }, paid: { $sum: '$paid' } } }
      ]),
    ]);

    const totalRevenue = revenueAgg[0]?.total ?? 0;
    const totalCredit = creditAgg[0]?.amount ?? 0;
    const totalPaidCredit = creditAgg[0]?.paid ?? 0;
    const outstanding = totalCredit - totalPaidCredit;

    // Estimate costs from products belonging to user's business
    const costAgg = await TransactionItem.aggregate([
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
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } }
    ]);
    const totalCost = costAgg.reduce((sum, item) => {
      const cost = item.product?.cost ?? 0;
      return sum + cost * item.qty;
    }, 0);

    res.json({
      totalRevenue,
      totalCost,
      netProfit: totalRevenue - totalCost,
      outstandingCredit: outstanding,
      grossMargin: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/reports/best-sellers
router.get('/best-sellers', async (req: AuthRequest, res: Response) => {
  try {
    const cats = await Category.find({ businessId: req.user!.businessId }).lean();
    const catIds = cats.map((c) => c._id);
    
    const products = await Product.find({ categoryId: { $in: catIds }, businessId: req.user!.businessId }).lean();
 
    const transactionItems = await TransactionItem.aggregate([
      {
        $lookup: {
          from: 'transactions',
          localField: 'transactionId',
          foreignField: '_id',
          as: 'transaction'
        }
      },
      { $unwind: '$transaction' },
      { $match: { 'transaction.businessId': new mongoose.Types.ObjectId(req.user!.businessId) } }
    ]);

    const itemsByProduct: any = {};
    transactionItems.forEach((ti) => {
      const pid = ti.productId.toString();
      if (!itemsByProduct[pid]) itemsByProduct[pid] = [];
      itemsByProduct[pid].push(ti);
    });

    const productsByCategory: any = {};
    products.forEach((p: any) => {
      const cid = p.categoryId.toString();
      if (!productsByCategory[cid]) productsByCategory[cid] = [];
      p.transactionItems = itemsByProduct[p._id.toString()] || [];
      productsByCategory[cid].push(p);
    });

    const result = cats
      .map((cat: any) => {
        const catProducts = productsByCategory[cat._id.toString()] || [];
        const totalQty = catProducts.reduce((sum: number, p: any) => sum + p.transactionItems.reduce((s: number, ti: any) => s + ti.qty, 0), 0);
        const totalRevenue = catProducts.reduce((sum: number, p: any) => sum + p.transactionItems.reduce((s: number, ti: any) => s + ti.qty * ti.price, 0), 0);
        return {
          categoryId: cat._id.toString(),
          name: cat.name,
          color: cat.color,
          totalQty,
          totalRevenue,
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/reports/staff
router.get('/staff', async (req: AuthRequest, res: Response) => {
  try {
    const users = await User.find({ businessId: req.user!.businessId }).lean();
    const userIds = users.map((u) => u._id);
    const transactions = await Transaction.find({ staffId: { $in: userIds }, businessId: req.user!.businessId })
      .select('total status staffId')
      .lean();

    const txsByUser: any = {};
    transactions.forEach((t) => {
      if (t.staffId) {
        const uid = t.staffId.toString();
        if (!txsByUser[uid]) txsByUser[uid] = [];
        txsByUser[uid].push(t);
      }
    });

    const result = users.map((u: any) => {
      const userTxs = txsByUser[u._id.toString()] || [];
      return {
        id: u._id.toString(),
        name: u.name,
        role: u.role,
        transactions: userTxs.length,
        totalSales: userTxs
          .filter((t: any) => t.status !== 'CREDIT')
          .reduce((sum: number, t: any) => sum + t.total, 0),
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
