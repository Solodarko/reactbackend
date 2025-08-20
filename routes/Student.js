const express = require('express');
const Student = require('../models/Student');
const router = express.Router();
const { body, validationResult } = require('express-validator');

// Helper function to validate time format
const isValidTime = (value) => /^([01]?[0-9]|2[0-3]):([0-5]?[0-9])$/.test(value);


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

// Get all students with Zoom participation info
router.get('/readstudents-with-zoom', async (req, res) => {
  try {
    const ZoomMeeting = require('../models/ZoomMeeting');
    
    // Get all students
    const students = await Student.find();
    
    // Get all zoom participants
    const meetings = await ZoomMeeting.find({}).select('participants topic meetingId startTime');
    
    // Create a map of student participation data
    const participationMap = new Map();
    
    meetings.forEach(meeting => {
      if (meeting.participants && meeting.participants.length > 0) {
        meeting.participants.forEach(participant => {
          if (participant.email) {
            const key = participant.email.toLowerCase();
            if (!participationMap.has(key)) {
              participationMap.set(key, {
                totalMeetings: 0,
                meetings: [],
                totalDuration: 0,
                lastActive: null,
                isZoomCreated: participant.isMatched && !students.some(s => s.Email.toLowerCase() === key && s.createdAt < participant.joinTime)
              });
            }
            
            const data = participationMap.get(key);
            data.totalMeetings++;
            data.meetings.push({
              meetingId: meeting.meetingId,
              topic: meeting.topic,
              joinTime: participant.joinTime,
              leaveTime: participant.leaveTime,
              duration: participant.duration || 0
            });
            
            if (participant.duration) {
              data.totalDuration += participant.duration;
            }
            
            if (!data.lastActive || (participant.joinTime && new Date(participant.joinTime) > new Date(data.lastActive))) {
              data.lastActive = participant.joinTime;
            }
          }
        });
      }
    });
    
    // Enhanced student data with Zoom info
    const enhancedStudents = students.map(student => {
      const participation = participationMap.get(student.Email.toLowerCase()) || {
        totalMeetings: 0,
        meetings: [],
        totalDuration: 0,
        lastActive: null,
        isZoomCreated: false
      };
      
      return {
        ...student.toObject(),
        zoomInfo: {
          hasParticipated: participation.totalMeetings > 0,
          totalMeetings: participation.totalMeetings,
          totalDurationSeconds: participation.totalDuration,
          totalDurationFormatted: formatDuration(participation.totalDuration),
          lastZoomActivity: participation.lastActive,
          recentMeetings: participation.meetings.slice(-3), // Last 3 meetings
          createdFromZoom: participation.isZoomCreated
        }
      };
    });
    
    // Get count statistics
    const totalStudents = students.length;
    const zoomParticipants = enhancedStudents.filter(s => s.zoomInfo.hasParticipated).length;
    const zoomCreatedStudents = enhancedStudents.filter(s => s.zoomInfo.createdFromZoom).length;
    
    res.status(200).json({
      students: enhancedStudents,
      statistics: {
        totalStudents,
        zoomParticipants,
        zoomCreatedStudents,
        nonZoomStudents: totalStudents - zoomParticipants
      }
    });
  } catch (error) {
    console.error('Error fetching students with Zoom data:', error);
    handleError(res, error);
  }
});

// Helper function to format duration
function formatDuration(seconds) {
  if (!seconds) return '0m';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

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


// POST: Save face descriptor for a student
router.post('/saveFaceDescriptor', async (req, res) => {
  const { faceDescriptor } = req.body; // Expect face descriptor array

  if (!faceDescriptor || !Array.isArray(faceDescriptor)) {
    return res.status(400).json({ error: 'Invalid face descriptor' });
  }

  try {
    // Find the student by their StudentID (you could modify this to match based on unique ID or email)
    const student = await Student.findOne({ StudentID: req.body.StudentID });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Save the face descriptor
    student.faceDescriptor = faceDescriptor;
    await student.save();

    res.status(200).json({ success: true, message: 'Face descriptor saved successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save face descriptor' });
  }
});




// POST: Validate student credentials for Zoom meeting participation
router.post('/validate', async (req, res) => {
  try {
    const { name, email, studentId } = req.body;
    
    // Validation
    if (!name || !email || !studentId) {
      return res.status(400).json({
        isValid: false,
        errors: ['Name, email, and student ID are required']
      });
    }

    // Try to find student by studentId, email, or name
    const student = await Student.findOne({
      $or: [
        { StudentID: studentId },
        { Email: { $regex: new RegExp(email, 'i') } },
        { $and: [{ FirstName: { $regex: new RegExp(name.split(' ')[0], 'i') } }] }
      ]
    });

    if (!student) {
      // Student not found in database - allow but warn
      return res.json({
        isValid: true, // Allow participation even if not in database
        warning: 'Student not found in records - proceeding with manual verification',
        student: null
      });
    }

    // Student found - validate data consistency
    const errors = [];
    const warnings = [];

    // Check name consistency
    const fullName = `${student.FirstName} ${student.LastName}`.toLowerCase();
    const providedName = name.toLowerCase();
    
    if (!fullName.includes(providedName) && !providedName.includes(fullName)) {
      warnings.push(`Name mismatch: Database shows "${fullName}", provided "${name}"`);
    }

    // Check email consistency
    if (student.Email.toLowerCase() !== email.toLowerCase()) {
      warnings.push(`Email mismatch: Database shows "${student.Email}", provided "${email}"`);
    }

    return res.json({
      isValid: errors.length === 0,
      errors,
      warnings,
      student: {
        id: student._id,
        studentId: student.StudentID,
        name: `${student.FirstName} ${student.LastName}`,
        email: student.Email,
        department: student.Department,
        phoneNumber: student.PhoneNumber
      }
    });

  } catch (error) {
    console.error('Error validating student credentials:', error);
    res.status(500).json({
      isValid: false,
      errors: ['Server error during validation']
    });
  }
});

module.exports = router;
