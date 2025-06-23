const express = require('express');
const router = express.Router();
const Session = require('../models/Session');

// Verify PIN and create/update session
router.post('/verify-pin', async (req, res) => {
  const { pin, deviceId, deviceName } = req.body;

  if (!pin || !deviceId || !deviceName) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields'
    });
  }

  try {
    const existingSession = await Session.findOne({ pin });

    if (existingSession) {
      // If same device, we'll handle the socket update in the socket.io handler
      if (existingSession.deviceId === deviceId) {
        return res.status(200).json({
          success: true,
          message: 'Same device detected',
          isSameDevice: true,
          existingSession
        });
      }

      // For different device, delete old session first
      await Session.deleteOne({ pin });
    }

    // Create new session (socketId will be added later)
    const newSession = new Session({
      pin,
      deviceId,
      deviceName
    });

    await newSession.save();

    res.status(200).json({
      success: true,
      message: existingSession ? 'New device registered' : 'New PIN created',
      isSameDevice: false,
      existingDevice: existingSession?.deviceName,
      session: newSession
    });

  } catch (error) {
    console.error('Error in verify-pin:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;