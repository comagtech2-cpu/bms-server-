import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User, BusinessProfile } from '../models';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['OWNER', 'STAFF']).optional().default('STAFF'),
  businessName: z.string().optional(),
});

// POST /api/v1/auth/login
router.post('/login', async (req, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid email or password' }) as any;

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ message: 'Invalid email or password' }) as any;

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, businessId: user.businessId },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/v1/auth/register
router.post('/register', async (req, res: Response) => {
  try {
    const { name, email, password, role, businessName } = registerSchema.parse(req.body);
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' }) as any;

    let businessId;
    if (role === 'OWNER') {
      if (!businessName) {
        return res.status(400).json({ message: 'Business name is required for registration' }) as any;
      }
      
      const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
      let uniqueSlug = slug || 'business';
      let counter = 1;
      while (await BusinessProfile.exists({ slug: uniqueSlug })) {
        uniqueSlug = `${slug}-${counter++}`;
      }

      const business = await BusinessProfile.create({
        name: businessName,
        slug: uniqueSlug,
        currency: '$',
        vatRate: 7.5,
        enableCostTracking: true,
      });
      businessId = business._id;
    } else {
      let defaultBusiness = await BusinessProfile.findOne();
      if (!defaultBusiness) {
        defaultBusiness = await BusinessProfile.create({
          name: 'CoMag Inventory',
          currency: '$',
          vatRate: 7.5,
          enableCostTracking: true,
        });
      }
      businessId = defaultBusiness._id;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed, role, businessId });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, businessId: user.businessId },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/v1/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user!.id).select('id name email role createdAt');
    res.json(user);
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

// POST /api/v1/auth/change-password
router.post('/change-password', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await User.findById(req.user!.id);
    if (!user) return res.status(404).json({ message: 'User not found' }) as any;

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(400).json({ message: 'Incorrect current password' }) as any;

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(user.id, { password: hashed });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
