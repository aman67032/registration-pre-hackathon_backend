import express from 'express';
import cors from 'cors';
import { connectDB } from './db';
import registerRouter from './routes/register';
import adminRouter from './routes/admin';

const app = express();
const PORT = 5000;

// Middleware
// Middleware
app.use(cors({
    origin: '*', // Allow all origins (for hackathon/dev), restricts to specific domains in prod ideally
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api', registerRouter);
app.use('/api/admin', adminRouter);

// Health check
app.get('/', (_req, res) => {
    res.json({ status: 'ok', message: 'Pre-Hackathon Backend is running 🚀' });
});

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', message: 'Pre-Hackathon Backend is running 🚀' });
});

// Connect DB - Removed global call for serverless, handled in routes
// connectDB();

// Start server only if not running in Vercel
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`\n🚀 Pre-Hackathon Backend running on http://localhost:${PORT}`);
        console.log(`   Health: http://localhost:${PORT}/api/health`);
        console.log(`   Register: POST http://localhost:${PORT}/api/register\n`);
    });
}

export default app;
