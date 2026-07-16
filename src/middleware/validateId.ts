import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

export function validateId(paramName: string = 'id') {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.params[paramName];
    if (id && !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: `Invalid ID format for parameter: ${paramName}` });
    }
    next();
  };
}
