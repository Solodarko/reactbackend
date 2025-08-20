const express = require('express');
const router = express.Router();
const faceapi = require('face-api.js');
const canvas = require('canvas');

// Route to save face descriptor
router.post('/createsaveFaceDescriptor', async (req, res) => {
  const { faceDescriptor } = req.body;

  if (!faceDescriptor) {
    return res.status(400).json({ error: 'No face descriptor provided' });
  }

  try {
    // Ensure faceDescriptor is in the correct format (array of floats, for example)
    const newFaceDescriptor = new FaceDescriptor({ descriptor: faceDescriptor });
    await newFaceDescriptor.save();
    res.status(201).json({ message: 'Face descriptor saved successfully!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save face descriptor' });
  }
});

// Route to get all face descriptors
router.get('/getFaceDescriptors', async (req, res) => {
  try {
    const faceDescriptors = await FaceDescriptor.find();
    res.status(200).json(faceDescriptors);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch face descriptors' });
  }
});

// Route to compare face descriptor
router.post('/compareFace', async (req, res) => {
  const { faceDescriptor } = req.body;

  if (!faceDescriptor) {
    return res.status(400).json({ error: 'No face descriptor provided' });
  }

  try {
    const faceDescriptors = await FaceDescriptor.find();
    
    // Loop through stored descriptors and compare each one
    const match = faceDescriptors.some((storedDescriptor) => {
      const distance = faceapi.euclideanDistance(faceDescriptor, storedDescriptor.descriptor);
      return distance < 0.6;  // Threshold for face recognition, you can adjust this
    });

    if (match) {
      res.status(200).json({ success: true, message: 'Face matched!' });
    } else {
      res.status(200).json({ success: false, message: 'No match found.' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error comparing face descriptors' });
  }
});

module.exports = router;
