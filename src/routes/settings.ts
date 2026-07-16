import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import multer from 'multer';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { BusinessProfile, User } from '../models';
import { authMiddleware, ownerOnly, AuthRequest } from '../middleware/auth';
import { uploadToCloudinary } from '../lib/cloudinary';
import { validateId } from '../middleware/validateId';

const router = Router();

// GET /api/v1/settings/business (Public endpoint for Login branding)
router.get('/business', async (req, res) => {
  try {
    const { businessId, slug } = req.query;
    
    // Parse JWT token from authorization headers if present
    const authHeader = req.headers.authorization;
    let jwtBusinessId = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        jwtBusinessId = decoded.businessId;
      } catch (err) {
        // Ignore invalid tokens for public route
      }
    }

    let profile;
    if (slug) {
      profile = await BusinessProfile.findOne({ slug: String(slug).toLowerCase() });
    } else if (businessId && mongoose.Types.ObjectId.isValid(String(businessId))) {
      profile = await BusinessProfile.findById(businessId);
    } else if (jwtBusinessId && mongoose.Types.ObjectId.isValid(jwtBusinessId)) {
      profile = await BusinessProfile.findById(jwtBusinessId);
    } else {
      profile = await BusinessProfile.findOne();
    }
    if (!profile) {
      profile = await BusinessProfile.create({
        name: 'CoMag Inventory',
        slug: 'comag-inventory',
        currency: '$',
      });
    }
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.use(authMiddleware);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB limit
  },
});

const businessSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  currency: z.string().optional(),
  tagline: z.string().optional(),
  logo: z.string().optional(),
  enableCostTracking: z.boolean().optional(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
});

// PUT /api/v1/settings/business
router.put('/business', ownerOnly, async (req: AuthRequest, res: Response) => {
  try {
    const data = businessSchema.parse(req.body);
    const businessId = req.user!.businessId;
    let profile = await BusinessProfile.findById(businessId);
    if (!profile) {
      profile = await BusinessProfile.create({ _id: businessId, name: 'My Business', currency: '$', ...data });
    } else {
      profile = await BusinessProfile.findByIdAndUpdate(businessId, data, { new: true });
    }
    res.json(profile);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/v1/settings/upload-logo
router.post('/upload-logo', ownerOnly, upload.single('logo'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' }) as any;
    }

    const logoUrl = await uploadToCloudinary(req.file.buffer);
    const businessId = req.user!.businessId;

    let profile = await BusinessProfile.findById(businessId);
    if (!profile) {
      profile = await BusinessProfile.create({
        _id: businessId,
        name: 'My Business',
        currency: '$',
        logo: logoUrl,
      });
    } else {
      profile = await BusinessProfile.findByIdAndUpdate(
        businessId,
        { logo: logoUrl },
        { new: true }
      );
    }

    res.json(profile);
  } catch (err: any) {
    console.error('Logo upload error:', err);
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

// GET /api/v1/settings/staff
router.get('/staff', async (req: AuthRequest, res: Response) => {
  try {
    const staff = await User.find({ businessId: req.user!.businessId })
      .select('id name email role createdAt')
      .sort({ name: 'asc' });
    res.json(staff);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

const staffCreateSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['OWNER', 'STAFF']),
});

const staffUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(['OWNER', 'STAFF']).optional(),
});

// POST /api/v1/settings/staff
router.post('/staff', ownerOnly, async (req: AuthRequest, res: Response) => {
  try {
    const { name, email, password, role } = staffCreateSchema.parse(req.body);
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: 'Email already registered' }) as any;

    const hashed = await bcrypt.hash(password, 10);
    const createdUser = await User.create({ name, email, password: hashed, role, businessId: req.user!.businessId });
    const user = await User.findOne({ _id: createdUser._id, businessId: req.user!.businessId }).select('id name email role createdAt');

    res.status(201).json(user);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/v1/settings/staff/:id
router.put('/staff/:id', ownerOnly, validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const staffId = req.params.id;
    const data = staffUpdateSchema.parse(req.body);

    if (data.email) {
      const existing = await User.findOne({ email: data.email, _id: { $ne: staffId } });
      if (existing) return res.status(400).json({ message: 'Email already registered' }) as any;
    }

    const updateData: any = { ...data };
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }

    const user = await User.findOneAndUpdate(
      { _id: staffId, businessId: req.user!.businessId },
      updateData,
      { new: true }
    ).select('id name email role createdAt');
    
    if (!user) return res.status(404).json({ message: 'Staff member not found' }) as any;

    res.json(user);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0].message }) as any;
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/v1/settings/staff/:id
router.delete('/staff/:id', ownerOnly, validateId(), async (req: AuthRequest, res: Response) => {
  try {
    const staffId = req.params.id;
    if (req.user!.id === staffId) {
      return res.status(400).json({ message: 'You cannot delete yourself' }) as any;
    }

    const user = await User.findOne({ _id: staffId, businessId: req.user!.businessId });
    if (!user) return res.status(404).json({ message: 'Staff member not found' }) as any;
    await user.softDelete();
    
    res.json({ message: 'Staff deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
