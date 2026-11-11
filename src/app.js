import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import morgan from 'morgan';

import { logger } from './config/logger.js';
import { swaggerSpec } from './config/swagger.js';
import routes from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

// CORS MUST be before rate limiter and other middlewares to handle preflight
app.use(cors());

// Security Headers
app.use(helmet());

// Health check endpoint (lightweight, unauthenticated, non-cached, no DB queries)
app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json({
    status: 'ok',
    service: 'ruet-medical-backend'
  });
});

// HTTP Request Logging
app.use(morgan('dev', {
  stream: { write: (message) => logger.info(message.trim()) }
}));

// Rate limiting: max 100 requests per 15 minutes per IP
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api', limiter);

app.use(express.json());

// Prevent browser caching for all API routes
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/api', routes);

app.get('/', (req, res) => {
  res.send('RUET Medical Backend is running securely');
});

// Global Error Handler must be the last middleware
app.use(errorHandler);

export default app;
