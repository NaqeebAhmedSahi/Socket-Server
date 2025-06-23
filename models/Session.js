const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  pin: {
    type: String,
    required: true,
    unique: true
  },
  deviceId: {
    type: String,
    required: true
  },
  deviceName: {
    type: String,
    required: true
  },
  socketId: String,
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 86400 // 24 hours
  }
});

module.exports = mongoose.model('Session', sessionSchema);