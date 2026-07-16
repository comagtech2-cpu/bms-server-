import { Router, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Customer, CreditRecord, Payment, Transaction } from '../models';
import { authMiddleware, ownerOnly, AuthRequest } from '../middleware/auth';
import { validateId } from '../middleware/validateId';

const router = Router();
router.use(authMiddleware);

const customerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
});

const paymentSchema = z.object({
  creditRecordId: z.string(),
  amount: z.number().positive(),
  method: z.enum(['CASH', 'CARD', 'TRANSFER']).default('CASH'),
  note: z.string().optional(),
});

// GET /api/v1/customers
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { search, page, limit = '20' } = req.query;
    const query: any = { businessId: new mongoose.Types.ObjectId(req.user!.businessId) };
    if (search) query.name = { $regex: String(search), $options: 'i' };

    if (page) {
      const pageNum = Number(page);
      const limitNum = Number(limit);
      const skip = (pageNum - 1) * limitNum;

      const [customers, total] = await Promise.all([
        Customer.find(query).skip(skip).limit(limitNum).sort({ name: 'asc' }),
        Customer.countDocuments(query),
      ]);

      const customerIds = customers.map((c) => c._id);
      const counts = await Transaction.aggregate([
        { $match: { customerId: { $in: customerIds }, businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
        { $group: { _id: '$customerId', count: { $sum: 1 } } },
      ]);
      const countsMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));

      const result = customers.map((c) => {
        const json = c.toJSON() as any;
        return {
          ...json,
          _count: { transactions: countsMap[json.id] || 0 },
        };
      });

      return res.json({
        customers: result,
        total,
        page: pageNum,
        totalPages: Math.ceil(total / limitNum)
      });
    }

    const customers = await Customer.find(query).sort({ name: 'asc' });
    const customerIds = customers.map((c) => c._id);
    const counts = await Transaction.aggregate([
      { $match: { customerId: { $in: customerIds }, businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
      { $group: { _id: '$customerId', count: { $sum: 1 } } },
    ]);
    const countsMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));
    
    const result = customers.map((c) => {
      const json = c.toJSON() as any;
      return {
        ...json,
        _count: { transactions: countsMap[json.id] || 0 },
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/customers/credit/overview
router.get('/credit/overview', async (req: AuthRequest, res: Response) => {
  try {
    const customers = await Customer.find({ totalCredit: { $gt: 0 }, businessId: new mongoose.Types.ObjectId(req.user!.businessId) })
      .sort({ totalCredit: -1 })
      .lean();
    
    const customerIds = customers.map((c) => c._id);

    const creditRecords = await CreditRecord.find({
      customerId: { $in: customerIds },
      businessId: req.user!.businessId,
      $expr: { $lt: ['$paid', '$amount'] },
    })
      .populate('transaction', 'createdAt total')
      .lean();

    const counts = await Transaction.aggregate([
      { $match: { customerId: { $in: customerIds }, businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
      { $group: { _id: '$customerId', count: { $sum: 1 } } },
    ]);
    const countsMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));

    const creditRecordsByCustomer: any = {};
    creditRecords.forEach((record: any) => {
      const cid = record.customerId.toString();
      if (!creditRecordsByCustomer[cid]) {
        creditRecordsByCustomer[cid] = [];
      }
      record.id = record._id.toString();
      delete record._id;
      if (record.transaction) {
        record.transaction.id = record.transaction._id.toString();
        delete record.transaction._id;
      }
      creditRecordsByCustomer[cid].push(record);
    });

    const result = customers.map((c: any) => {
      const id = c._id.toString();
      c.id = id;
      delete c._id;
      c.creditRecords = creditRecordsByCustomer[id] || [];
      c._count = { transactions: countsMap[id] || 0 };
      return c;
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/customers/:id
router.get('/:id', validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, businessId: new mongoose.Types.ObjectId(req.user!.businessId) });
    if (!customer) return res.status(404).json({ message: 'Customer not found' }) as any;

    const transactions = await Transaction.find({ customerId: customer._id, businessId: new mongoose.Types.ObjectId(req.user!.businessId) })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate({
        path: 'items',
        populate: { path: 'product', select: 'name' },
      })
      .lean();

    const creditRecords = await CreditRecord.find({ customerId: customer._id, businessId: new mongoose.Types.ObjectId(req.user!.businessId) })
      .populate('payments')
      .lean();

    const payments = await Payment.find({ customerId: customer._id, businessId: new mongoose.Types.ObjectId(req.user!.businessId) })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const customerJson: any = customer.toJSON();

    const mapId = (arr: any[]) =>
      arr.map((item: any) => {
        item.id = item._id.toString();
        delete item._id;
        if (item.items) {
          item.items = item.items.map((i: any) => {
            i.id = i._id.toString();
            delete i._id;
            if (i.product) {
              i.product.id = i.product._id.toString();
              delete i.product._id;
            }
            return i;
          });
        }
        if (item.payments) {
          item.payments = mapId(item.payments);
        }
        return item;
      });

    customerJson.transactions = mapId(transactions);
    customerJson.creditRecords = mapId(creditRecords);
    customerJson.payments = mapId(payments);

    res.json(customerJson);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/v1/customers
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const data = customerSchema.parse(req.body);
    const businessId = req.user!.businessId;

    if (data.phone) {
      const exists = await Customer.findOne({ businessId, phone: data.phone });
      if (exists) return res.status(400).json({ message: 'A customer with this phone number already exists' }) as any;
    }
    if (data.email) {
      const exists = await Customer.findOne({ businessId, email: data.email });
      if (exists) return res.status(400).json({ message: 'A customer with this email already exists' }) as any;
    }

    const customer = await Customer.create({ ...data, email: data.email || undefined, businessId });
    res.status(201).json(customer);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    if ((err as any)?.code === 11000) return res.status(400).json({ message: 'A customer with this phone or email already exists' }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/v1/customers/:id
router.put('/:id', validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const data = customerSchema.partial().parse(req.body);
    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, businessId: new mongoose.Types.ObjectId(req.user!.businessId) },
      data,
      { new: true }
    );
    if (!customer) return res.status(404).json({ message: 'Customer not found' }) as any;
    res.json(customer);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    if ((err as any)?.code === 11000) return res.status(400).json({ message: 'A customer with this phone or email already exists' }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/v1/customers/:id/payment
router.post('/:id/payment', ownerOnly, validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const { creditRecordId, amount, method, note } = paymentSchema.parse(req.body);
    const customerId = req.params.id;

    const creditRecord = await CreditRecord.findOne({ _id: creditRecordId, businessId: new mongoose.Types.ObjectId(req.user!.businessId) });
    if (!creditRecord) return res.status(404).json({ message: 'Credit record not found' }) as any;

    const remaining = creditRecord.amount - creditRecord.paid;
    const payAmount = Math.min(amount, remaining);

    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      await Payment.create(
        [{ creditRecordId, customerId, amount: payAmount, method, note, businessId: new mongoose.Types.ObjectId(req.user!.businessId) }],
        { session }
      );

      await CreditRecord.findOneAndUpdate(
        { _id: creditRecordId, businessId: new mongoose.Types.ObjectId(req.user!.businessId) },
        { $inc: { paid: payAmount } },
        { session }
      );

      await Customer.findOneAndUpdate(
        { _id: customerId, businessId: new mongoose.Types.ObjectId(req.user!.businessId) },
        { $inc: { totalCredit: -payAmount } },
        { session }
      );
    });
    session.endSession();

    res.json({ message: 'Payment recorded', amount: payAmount });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
