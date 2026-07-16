import { Router, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Product, StockMovement } from '../models';
import { authMiddleware, ownerOnly, AuthRequest } from '../middleware/auth';
import { validateId } from '../middleware/validateId';

// Generate a unique SKU like PRD-000001, PRD-000002, etc.
async function generateSKU(businessId: string): Promise<string> {
  const prefix = 'PRD';
  // Find the latest product for this business, sorted by createdAt descending
  const latest = await Product.findOne({ businessId })
    .sort({ createdAt: -1 })
    .select('sku')
    .lean();

  let nextNum = 1;
  if (latest?.sku) {
    const match = latest.sku.match(/^PRD-(\d+)$/);
    if (match) {
      nextNum = parseInt(match[1], 10) + 1;
    } else {
      // If existing SKUs don't follow our pattern, count total products
      const count = await Product.countDocuments({ businessId });
      nextNum = count + 1;
    }
  }

  const sku = `${prefix}-${String(nextNum).padStart(6, '0')}`;

  // Verify uniqueness, if collision append timestamp
  const exists = await Product.findOne({ sku }).lean();
  if (exists) {
    return `${prefix}-${Date.now()}`;
  }
  return sku;
}

const router = Router();
router.use(authMiddleware);

const productSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional(),
  price: z.number().min(0).optional().default(0),
  cost: z.number().min(0).optional().default(0),
  stock: z.number().int().min(0).optional().default(0),
  minStock: z.number().int().min(0).optional().default(5),
  categoryId: z.string(),
  image: z.string().optional(),
});

// GET /api/v1/products
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { search, categoryId, inStock } = req.query;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const skip = (page - 1) * limit;

    const query: any = { businessId: req.user!.businessId };
    if (search) {
      const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.name = { $regex: safe, $options: 'i' };
    }
    if (categoryId) query.categoryId = categoryId;
    if (inStock === 'true') query.stock = { $gt: 0 };
    if (inStock === 'false') query.stock = { $lte: 0 };

    const businessObjId = mongoose.Types.ObjectId.isValid(req.user!.businessId)
      ? new mongoose.Types.ObjectId(req.user!.businessId)
      : null;

    const [products, total, summary] = await Promise.all([
      Product.find(query)
        .populate('category', 'id name color')
        .sort({ name: 'asc' })
        .skip(skip)
        .limit(limit),
      Product.countDocuments(query),
      businessObjId
        ? Product.aggregate([
            { $match: { businessId: businessObjId } },
            { $group: {
              _id: null,
              totalValue: { $sum: { $multiply: ['$price', '$stock'] } },
              lowStockCount: {
                $sum: { $cond: [{ $lte: ['$stock', '$minStock'] }, 1, 0] },
              },
            }},
          ])
        : Promise.resolve([]),
    ]);

    res.json({
      data: products,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      summary: summary[0] || { totalValue: 0, lowStockCount: 0 },
    });
  } catch (err) {
    console.error('[GET /products] Error:', err);
    res.status(500).json({ message: 'Server error', detail: (err as any)?.message });
  }
});
router.get('/low-stock', async (req: AuthRequest, res: Response) => {
  try {
    const products = await Product.find({
      businessId: req.user!.businessId,
      $expr: { $lte: ['$stock', '$minStock'] }
    })
      .populate('category', 'name color')
      .sort({ stock: 'asc' });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/products/:id
router.get('/:id', validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, businessId: req.user!.businessId }).populate('category');
    if (!product) return res.status(404).json({ message: 'Product not found' }) as any;
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/v1/products
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const data = productSchema.parse(req.body);

    // Auto-generate SKU if not provided
    const sku = data.sku || await generateSKU(req.user!.businessId as string);

    let product = await Product.create({ ...data, sku, businessId: req.user!.businessId });
    product = await product.populate('category', 'id name color');

    // Record stock movement
    if (data.stock > 0) {
      await StockMovement.create({
        productId: product.id,
        type: 'IN',
        qty: data.stock,
        note: 'Initial stock',
        businessId: req.user!.businessId,
      });
    }
    res.status(201).json(product);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    if ((err as any)?.code === 11000) {
      return res.status(409).json({ message: 'A product with this SKU already exists' }) as any;
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/v1/products/:id
router.put('/:id', validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const data = productSchema.partial().parse(req.body);
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, businessId: req.user!.businessId },
      data,
      { new: true }
    ).populate('category', 'id name color');
    if (!product) return res.status(404).json({ message: 'Product not found' }) as any;
    res.json(product);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/v1/products/:id
router.delete('/:id', ownerOnly, validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const product = await Product.findOne({ _id: req.params.id, businessId: req.user!.businessId });
    if (!product) return res.status(404).json({ message: 'Product not found' }) as any;
    await product.softDelete();
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
