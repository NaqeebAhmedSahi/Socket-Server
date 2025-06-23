const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  pin: {
    type: String,
    required: true,
    unique: true,
  },
  deviceId: {
    type: String,
    required: true,
  },
  socketId: {
    type: String,
    default: null, // Make it optional initially
  },
  deviceName: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400, // Automatically delete after 24 hours
  },
});

module.exports = mongoose.model('Session', sessionSchema);