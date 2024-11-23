require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const StudentRoutes = require('./routes/Student'); 

const app = express();
// Middleware
app.use(express.json());

// CORS Options
const corsOptions = {
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

// Connect to MongoDB
connectDB();

// Routes
app.use('/auth', authRoutes);
// app.use('/api', postRoutes);
app.use('/stu',StudentRoutes); 

// Start server
const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
