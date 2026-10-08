import { logger } from '../config/logger.js';

// Global Error Handler Middleware
export const errorHandler = (err, req, res, next) => {
  logger.error(`${err.name}: ${err.message}`);
  
  if (err.stack && process.env.NODE_ENV !== 'production') {
    logger.debug(err.stack);
  }

  // Handle specific Supabase or standard error types here if needed
  if (err.code === '23505') { // Example PostgreSQL unique violation
    return res.status(409).json({ error: 'Resource already exists' });
  }

  const statusCode = err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: message,
    // Provide stack trace only if not in production
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
};
