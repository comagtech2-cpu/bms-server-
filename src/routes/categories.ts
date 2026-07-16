import { Router, Response } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import { Category, Product } from '../models';
import { authMiddleware, ownerOnly, AuthRequest } from '../middleware/auth';
import { validateId } from '../middleware/validateId';

const router = Router();
router.use(authMiddleware);

const categorySchema = z.object({
  name: z.string().min(1),
  color: z.string().optional().default('#4f7cff'),
  icon: z.string().optional(),
});

// GET /api/v1/categories
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const categories = await Category.find({ businessId: req.user!.businessId }).sort({ name: 'asc' });
    const categoryIds = categories.map((c) => c._id);
    const counts = await Product.aggregate([
      { $match: { categoryId: { $in: categoryIds }, businessId: new mongoose.Types.ObjectId(req.user!.businessId) } },
      { $group: { _id: '$categoryId', count: { $sum: 1 } } },
    ]);
    const countsMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));
    
    const result = categories.map((c) => {
      const json = c.toJSON() as any;
      return {
        ...json,
        _count: { products: countsMap[json.id] || 0 },
      };
    });
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/v1/categories
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const data = categorySchema.parse(req.body);
    const category = await Category.create({ ...data, businessId: req.user!.businessId });
    res.status(201).json(category);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/v1/categories/:id
router.put('/:id', validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const data = categorySchema.partial().parse(req.body);
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, businessId: req.user!.businessId },
      data,
      { returnDocument: 'after' }
    );
    if (!category) return res.status(404).json({ message: 'Category not found' }) as any;
    res.json(category);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/v1/categories/:id
router.delete('/:id', ownerOnly, validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const category = await Category.findOne({ _id: req.params.id, businessId: req.user!.businessId });
    if (!category) return res.status(404).json({ message: 'Category not found' }) as any;
    await category.softDelete();
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
