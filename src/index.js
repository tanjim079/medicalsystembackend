import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import routes from './routes/index.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
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
  res.send('RUET Medical Backend is running');
});

app.get('/api/testenv', (req, res) => {
  res.json({
    secretKeyExists: !!process.env.SUPABASE_SECRET_KEY,
    keyLength: process.env.SUPABASE_SECRET_KEY ? process.env.SUPABASE_SECRET_KEY.length : 0,
    cwd: process.cwd()
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
