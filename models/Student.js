const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema(
  {
    StudentID: {
      type: Number,
      required: true,
      unique: true,
      trim: true,
    },
    FirstName: {
      type: String,
      required: true,
      trim: true,
    },
    LastName: {
      type: String,
      required: true,
      trim: true,
    },
    Email: {
      type: String,
      required: true, // Ensure this matches your route's expectations
      unique: true,
      trim: true,
    },
    PhoneNumber: {
      type: String,
      required: true,
    },
    DateOfBirth: {
      type: Date,
      required: true,
    },
    Gender: {
      type: String,
      enum: ['Male', 'Female', 'Other'],
      required: true,
    },
    Department: {
      type: String,
      required: true,
      enum: ['R & I', 'Faculty', 'Consultancy', 'Corporate'],
      trim: true,
    },
    TimeIn: {
      type: Date,
      required: true,
    },
    TimeOut: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

const Student = mongoose.model('Student', studentSchema);

module.exports = Student;
