import { Router, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Transaction, TransactionItem, Product, StockMovement, CreditRecord, Customer } from '../models';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { validateId } from '../middleware/validateId';

const router = Router();
router.use(authMiddleware);

const checkoutSchema = z.object({
  customerId: z.string().optional(),
  guestName: z.string().optional(),
  paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER', 'CREDIT']),
  amountPaid: z.number().min(0),
  note: z.string().optional(),
  items: z.array(z.object({
    productId: z.string(),
    qty: z.number().int().positive(),
    price: z.number().min(0),
  })).min(1),
});

// GET /api/v1/transactions
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', method, status, from, to } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const query: any = { businessId: req.user!.businessId };
    if (method) query.paymentMethod = String(method);
    if (status) query.status = String(status);
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(String(from));
      if (to) query.createdAt.$lte = new Date(String(to));
    }

    const [txDocs, total] = await Promise.all([
      Transaction.find(query)
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 })
        .populate('customer', 'name phone')
        .populate('staff', 'name')
        .populate({
          path: 'items',
          populate: { path: 'product', select: 'name sku' }
        }),
      Transaction.countDocuments(query),
    ]);

    const transactions = txDocs.map((t) => t.toJSON());

    res.json({ transactions, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/transactions/:id
router.get('/:id', validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const tx = await Transaction.findOne({ _id: req.params.id, businessId: req.user!.businessId })
      .populate('customer')
      .populate('staff', 'name')
      .populate({
        path: 'items',
        populate: {
          path: 'product',
          select: 'name sku categoryId',
          populate: { path: 'category', select: 'name' }
        }
      })
      .populate('creditRecord');

    if (!tx) return res.status(404).json({ message: 'Transaction not found' }) as any;
    res.json(tx.toJSON());
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/v1/transactions (checkout)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { customerId, guestName, paymentMethod, amountPaid, note, items } = checkoutSchema.parse(req.body);

    if (paymentMethod === 'CREDIT' && !customerId) {
      return res.status(400).json({ message: 'Customer is required for credit transactions' }) as any;
    }

    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const change = paymentMethod === 'CASH' ? Math.max(0, amountPaid - total) : 0;
    const status = paymentMethod === 'CREDIT' ? 'CREDIT' : amountPaid >= total ? 'PAID' : 'PARTIAL';

    const session = await mongoose.startSession();
    let transactionResult: any = null;

    await session.withTransaction(async () => {
      const [transaction] = await Transaction.create(
        [{
          customerId: customerId || undefined,
          guestName: guestName || undefined,
          staffId: req.user!.id,
          total,
          amountPaid: paymentMethod === 'CREDIT' ? 0 : amountPaid,
          change,
          paymentMethod,
          status,
          note,
          businessId: req.user!.businessId,
        }],
        { session, ordered: true }
      );

      const itemDocs = items.map((item) => ({
        transactionId: transaction._id,
        productId: item.productId,
        qty: item.qty,
        price: item.price,
      }));
      await TransactionItem.create(itemDocs, { session, ordered: true });

      for (const item of items) {
        const product = await Product.findOne({ _id: item.productId, businessId: req.user!.businessId }).session(session);
        if (!product) throw new Error('Product not found');
        if (product.stock < item.qty) {
          const err: any = new Error(`Insufficient stock for product "${product.name}" (Available: ${product.stock}, Requested: ${item.qty})`);
          err.statusCode = 400;
          throw err;
        }
        product.stock -= item.qty;
        await product.save({ session });

        await StockMovement.create(
          [{
            productId: item.productId,
            type: 'OUT',
            qty: item.qty,
            note: `Sale #${transaction._id}`,
            businessId: req.user!.businessId,
          }],
          { session, ordered: true }
        );
      }

      if (paymentMethod === 'CREDIT' && customerId) {
        await CreditRecord.create(
          [{
            customerId,
            transactionId: transaction._id,
            amount: total,
            businessId: req.user!.businessId,
          }],
          { session, ordered: true }
        );
        await Customer.findOneAndUpdate(
          { _id: customerId, businessId: req.user!.businessId },
          { $inc: { totalCredit: total } },
          { session }
        );
      }

      transactionResult = await Transaction.findOne({ _id: transaction._id, businessId: req.user!.businessId })
        .populate('customer')
        .populate('staff', 'name')
        .populate({
          path: 'items',
          populate: { path: 'product', select: 'name sku' }
        })
        .session(session);
    });

    session.endSession();

    if (!transactionResult) {
      throw new Error('Transaction checkout failed to save');
    }

    res.status(201).json(transactionResult.toJSON());
  } catch (err: any) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message }) as any;
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
