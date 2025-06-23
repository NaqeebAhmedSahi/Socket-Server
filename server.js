require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');
const Session = require('./models/Session');
const authRoutes = require('./routes/auth');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDB();

// Routes
app.use('/api/auth', authRoutes);

// Socket.io connection
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('register-pin', async ({ pin, deviceId, deviceName }) => {
    try {
      // Find all sessions with this PIN (should be only one due to unique constraint)
      const sessions = await Session.find({ pin });
      
      // If no session exists, this is invalid (shouldn't happen if frontend flows are correct)
      if (sessions.length === 0) {
        socket.emit('invalid-pin', { message: 'No session found for this PIN' });
        return;
      }

      const existingSession = sessions[0];

      // If this is a different socket from the same device
      if (existingSession.deviceId === deviceId) {
        // Notify previous socket to logout if it exists and is different
        if (existingSession.socketId && existingSession.socketId !== socket.id) {
          io.to(existingSession.socketId).emit('force-logout', {
            message: 'Logged out from same device - new session',
            newDevice: deviceName,
            isSameDevice: true
          });
        }

        // Update the session with new socket ID
        existingSession.socketId = socket.id;
        await existingSession.save();

        socket.emit('pin-registered', {
          message: 'Session updated for same device',
          isSameDevice: true
        });
        return;
      }

      // If this is a different device
      if (existingSession.socketId) {
        // Notify previous device to logout
        io.to(existingSession.socketId).emit('force-logout', {
          message: 'Logged out from another device',
          newDevice: deviceName,
          isSameDevice: false
        });
      }

      // Update session with new device info
      existingSession.deviceId = deviceId;
      existingSession.socketId = socket.id;
      existingSession.deviceName = deviceName;
      await existingSession.save();

      socket.emit('pin-registered', {
        message: 'New device registered',
        isSameDevice: false,
        previousDevice: existingSession.deviceName
      });

    } catch (error) {
      console.error('Socket registration error:', error);
      socket.emit('error', { message: 'Error registering PIN' });
    }
  });

  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id);
    try {
      // Clean up socketId when client disconnects
      await Session.updateOne(
        { socketId: socket.id },
        { $set: { socketId: null } }
      );
    } catch (error) {
      console.error('Error cleaning up socketId:', error);
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});