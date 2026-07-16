import { Response, NextFunction } from 'express';
import { AuditLog } from '../models';
import { AuthRequest } from './auth';

const entityMap: Record<string, string> = {
  '/products': 'Product',
  '/categories': 'Category',
  '/customers': 'Customer',
  '/transactions': 'Transaction',
  '/inventory': 'StockMovement',
  '/settings': 'BusinessProfile',
  '/auth': 'User',
};

export function auditLog(entityOverride?: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') {
      next();
      return;
    }

    const firstSegment = '/' + (req.path.split('/').filter(Boolean)[0] || '');
    const entity = entityOverride || entityMap[firstSegment] || 'Unknown';
    const action = req.method === 'POST' ? 'CREATE' : req.method === 'DELETE' ? 'DELETE' : 'UPDATE';

    let before: Record<string, any> | undefined;

    if ((action === 'UPDATE' || action === 'DELETE') && req.params.id) {
      try {
        const { Product, Category, Customer, Transaction, StockMovement, BusinessProfile } = await import('../models');
        const models: Record<string, any> = {
          Product, Category, Customer, Transaction, StockMovement, BusinessProfile,
        };
        const Model = models[entity];
        if (Model) {
          const doc = await Model.findById(req.params.id).lean();
          if (doc && typeof doc === 'object') {
            const copy: Record<string, any> = { ...doc };
            delete copy._id;
            delete copy.__v;
            before = copy;
          }
        }
      } catch {
        // silent — best-effort
      }
    }

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      setImmediate(async () => {
        try {
          if (!req.user?.id) return;
          const after = action === 'DELETE' ? before : body;
          await AuditLog.create({
            userId: req.user.id,
            businessId: req.user.businessId,
            action,
            entity,
            entityId: req.params.id || body?.id,
            before,
            after: after && typeof after === 'object' ? { ...after } : after,
            ip: req.ip,
          });
        } catch {
          // silent — audit log failure must not break the request
        }
      });
      return originalJson(body);
    };

    next();
  };
}
