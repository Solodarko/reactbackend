const express = require('express');
const Student = require('../models/Student');
const router = express.Router();
const { body, validationResult } = require('express-validator');

// Helper function to validate time format
const isValidTime = (value) => /^([01]?[0-9]|2[0-3]):([0-5]?[0-9])$/.test(value);

// Helper function for error response
// const handleError = (res, error, statusCode = 500) => {
//   console.error('Error:', error);
//   res.status(statusCode).json({ message: 'An error occurred', error: error.message });
// };

const handleError = (res, error, statusCode = 500) => {
  console.error('Error:', error);
  if (error.code === 11000) {  // MongoDB duplicate key error code
    return res.status(400).json({ message: 'Duplicate key error: ' + error.message });
  }
  res.status(statusCode).json({ message: 'An error occurred', error: error.message });
};


// Create a new student

router.post(
  '/createstudents',
  [
    body('FirstName').notEmpty().withMessage('FirstName is required'),
    body('LastName').notEmpty().withMessage('LastName is required'),
    body('Email').isEmail().withMessage('Invalid Email format').notEmpty().withMessage('Email is required'),
    body('PhoneNumber').matches(/^\d{10,15}$/).withMessage('Phone number must be 10-15 digits'),
    body('DateOfBirth').isISO8601().withMessage('DateOfBirth must be in YYYY-MM-DD format'),
    body('Gender').isIn(['Male', 'Female', 'Other']).withMessage('Invalid Gender'),
    body('Department').isIn(['R & I', 'Faculty', 'Consultancy', 'Corporate']).withMessage('Invalid Department'),
    body('TimeIn').notEmpty().withMessage('TimeIn is required').custom(isValidTime).withMessage('Invalid TimeIn format'),
    body('TimeOut').optional().custom(isValidTime).withMessage('Invalid TimeOut format'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation Error', errors: errors.array() });
    }

    try {
      const { TimeIn, TimeOut, Email, ...studentData } = req.body;

      // Ensure no duplicate email exists
      const existingStudent = await Student.findOne({ Email });
      if (existingStudent) {
        return res.status(400).json({ message: 'Email already exists' });
      }

      // Parse TimeIn and TimeOut into Date objects
      const parseTime = (time) => {
        if (time) {
          const today = new Date().toISOString().split('T')[0];
          return new Date(`${today}T${time}:00`);
        }
        return undefined;
      };

      const student = new Student({
        ...studentData,
        Email,
        TimeIn: parseTime(TimeIn),
        TimeOut: parseTime(TimeOut),
      });

      await student.save();
      res.status(201).json(student);
    } catch (error) {
      handleError(res, error);
    }
  }
);

// Get all students
router.get('/readstudents', async (req, res) => {
  try {
    const students = await Student.find();
    res.status(200).json(students);
  } catch (error) {
    handleError(res, error);
  }
});

// Get a student by ID
router.get('/readstudents/:id', async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    res.status(200).json(student);
  } catch (error) {
    handleError(res, error);
  }
});

// Update a student by ID
router.put('/updatestudents/:id', async (req, res) => {
  try {
    // Destructure TimeIn, TimeOut, and other fields from the request body
    const { TimeIn, TimeOut, ...updateData } = req.body;

    // Ensure TimeIn and TimeOut are parsed as Date objects if provided
    const parsedTimeIn = TimeIn ? new Date(`${new Date().toISOString().split('T')[0]}T${TimeIn}:00`) : undefined;
    const parsedTimeOut = TimeOut ? new Date(`${new Date().toISOString().split('T')[0]}T${TimeOut}:00`) : undefined;

    // Prepare the update object
    const updateFields = {
      ...updateData,
      ...(parsedTimeIn && { TimeIn: parsedTimeIn }),
      ...(parsedTimeOut && { TimeOut: parsedTimeOut }),
    };

    // Update the student in the database
    const updatedStudent = await Student.findByIdAndUpdate(
      req.params.id,
      updateFields,
      { new: true, runValidators: true }
    );

    // If no student is found, return a 404 error
    if (!updatedStudent) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Return the updated student data
    res.status(200).json(updatedStudent);
  } catch (error) {
    // Generic error handler
    console.error(error); // Log the error for debugging
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});


// Delete a student by ID
router.delete('/deletestudents/:id', async (req, res) => {
  try {
    const deletedStudent = await Student.findByIdAndDelete(req.params.id);
    if (!deletedStudent) {
      return res.status(404).json({ message: 'Student not found' });
    }
    res.status(204).send();
  } catch (error) {
    handleError(res, error);
  }
});

module.exports = router;
