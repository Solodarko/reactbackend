const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    // Replace 'YOUR_SECRET_KEY' with the actual secret key
    const decoded = jwt.verify(token, 'YOUR_SECRET_KEY');
    req.user = decoded; // Attach the decoded user to the request
    next(); // Call next() to pass control to the next middleware
  } catch (error) {
    console.error('Token verification failed:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

module.exports = auth;
