import { Router, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Product, StockMovement } from '../models';
import { authMiddleware, ownerOnly, AuthRequest } from '../middleware/auth';

const router = Router();
router.use(authMiddleware);

const restockSchema = z.object({
  productId: z.string(),
  qty: z.number().int().positive(),
  note: z.string().optional(),
});

// GET /api/v1/inventory/movements
router.get('/movements', async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', productId } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const query: any = { businessId: req.user!.businessId };
    if (productId) query.productId = productId;

    const [movements, total] = await Promise.all([
      StockMovement.find(query)
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 })
        .populate({
          path: 'product',
          select: 'name sku categoryId',
          populate: { path: 'category', select: 'name' }
        }),
      StockMovement.countDocuments(query),
    ]);

    res.json({ movements, total, page: Number(page) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/v1/inventory/restock
router.post('/restock', ownerOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { productId, qty, note } = restockSchema.parse(req.body);

    // Verify product belongs to user's business
    const product = await Product.findOne({ _id: productId, businessId: req.user!.businessId });
    if (!product) return res.status(404).json({ message: 'Product not found' }) as any;

    const session = await mongoose.startSession();
    let movementDoc;
    let productDoc;

    await session.withTransaction(async () => {
      const created = await StockMovement.create(
        [{ productId, type: 'IN', qty, note: note || 'Restock', businessId: req.user!.businessId }],
        { session, ordered: true }
      );
      movementDoc = created[0];

      productDoc = await Product.findOneAndUpdate(
        { _id: productId, businessId: req.user!.businessId },
        { $inc: { stock: qty } },
        { returnDocument: 'after', session }
      ).populate('category', 'name color');
      
      if (!productDoc) {
        throw new Error('Product not found');
      }
    });

    session.endSession();

    res.status(201).json({ movement: movementDoc, product: productDoc });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
