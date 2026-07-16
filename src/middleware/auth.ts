import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, BusinessProfile } from '../models';

export interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string; businessId: string };
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      email: string;
      role: string;
      businessId: string;
    };
    
    // Verify user profile is active and has not been deleted
    const userExists = await User.exists({ _id: decoded.id });
    if (!userExists) {
      res.status(401).json({ message: 'Account has been deleted' });
      return;
    }

    // Check if the business is suspended
    if (decoded.businessId) {
      const business = await BusinessProfile.findById(decoded.businessId).select('isSuspended').lean();
      if (!business) {
        res.status(403).json({ message: 'Your business account has been removed. Please contact support.' });
        return;
      }
      if (business.isSuspended) {
        res.status(403).json({ message: 'Your business has been suspended. Please contact the platform administrator.' });
        return;
      }
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export const ownerOnly = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (req.user?.role !== 'OWNER') {
    res.status(403).json({ message: 'Owner access required' });
    return;
  }
  next();
};
