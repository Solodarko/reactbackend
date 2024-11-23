const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/authentication');
const router = express.Router();
// Register a new user

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    console.log("Request body:", req.body);

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
    }

    // Create a new user
    const user = new User({ username, email, password });
    await user.save();

    // Generate a token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });

    // Send success response with token
    res.status(201).json({ success: true, token });
  } catch (error) {
    // Send error response
    res.status(500).json({ success: false, message: 'Server error' });
  }
});
// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, token });  // Include { success: true } for a successful response
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/protected-route', auth, (req, res) => {
  res.json({ message: 'Access granted to protected route' });
});


module.exports = router;
