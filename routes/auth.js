const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { auth, checkRole } = require('../middleware/auth');

const router = express.Router();

// ===========================
// REGISTER NEW USER
// ===========================
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    if (role && !['user', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role specified'
      });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    const user = new User({ username, email, password, role });
    await user.save();

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('authToken', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      username: user.username,
      role: user.role,
      token,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering user',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ===========================
// LOGIN USER
// ===========================
  router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      {
        userId: user._id,
        username: user.username,
        role: user.role,
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Configure cookie options based on environment
    const cookieOptions = {
      httpOnly: false, // Allow frontend to read the cookie
      secure: process.env.NODE_ENV === 'production', // Only secure in production
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Required for cross-site in production
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    };
    
    // Add domain for production if specified
    if (process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN) {
      cookieOptions.domain = process.env.COOKIE_DOMAIN;
    }

    res.clearCookie('authToken', { path: '/' });
    res.clearCookie('username', { path: '/' });
    res.clearCookie('userRole', { path: '/' });

    res.cookie('authToken', token, cookieOptions);
    res.cookie('username', user.username, cookieOptions);
    res.cookie('userRole', user.role, cookieOptions);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      username: user.username,
      role: user.role,
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ===========================
// LOGOUT USER
// ===========================
router.post('/logout', (req, res) => {
  res.clearCookie('authToken');
  res.clearCookie('username');
  res.clearCookie('userRole');
  res.status(200).json({ success: true, message: 'Logged out successfully' });
});

// ===========================
// GET CURRENT USER
// ===========================
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user data' });
  }
});

// ===========================
// GET ALL USERS (ADMIN ONLY)
// ===========================
router.get('/users', auth, checkRole(['admin']), async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// ===========================
// UPDATE USER ROLE (ADMIN ONLY)
// ===========================
router.patch('/users/:userId/role', auth, checkRole(['admin']), async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role value' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error updating user role' });
  }
});

// ===========================
// VERIFY TOKEN
// ===========================
router.get('/verify', auth, (req, res) => {
  try {
    // If auth middleware passed, token is valid and user attached to req
    return res.status(200).json({
      success: true,
      message: 'Token is valid',
      user: {
        id: req.user._id,
        username: req.user.username,
        role: req.user.role,
      },
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({
      success: false,
      message: 'Invalid token',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// ===========================
// GET USER PROFILE WITH STUDENT INFO
// ===========================
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Try to find associated student record by email or username
    const Student = require('../models/Student');
    let studentInfo = null;
    
    try {
      // First try to find by email match
      studentInfo = await Student.findOne({ Email: user.email });
      
      // If not found by email, try to find by username in email field (if email format)
      if (!studentInfo && user.username.includes('@')) {
        studentInfo = await Student.findOne({ Email: user.username });
      }
      
      // If still not found, try to find by matching first name or username patterns
      if (!studentInfo) {
        const usernamePattern = new RegExp(user.username.split(/[^a-zA-Z]+/)[0], 'i');
        studentInfo = await Student.findOne({
          $or: [
            { FirstName: usernamePattern },
            { LastName: usernamePattern }
          ]
        });
      }
    } catch (studentError) {
      console.warn('Error finding student record:', studentError.message);
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      },
      student: studentInfo ? {
        studentId: studentInfo.StudentID,
        firstName: studentInfo.FirstName,
        lastName: studentInfo.LastName,
        email: studentInfo.Email,
        phoneNumber: studentInfo.PhoneNumber,
        department: studentInfo.Department,
        fullName: `${studentInfo.FirstName} ${studentInfo.LastName}`
      } : null,
      hasStudentRecord: !!studentInfo
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile data',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


module.exports = router;
