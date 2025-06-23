require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const Session = require('./models/Session');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Track active sessions in memory
const activeSessions = new Map();

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  socket.on('register-session', async ({ pin, deviceId, deviceName }) => {
    try {
      // Find existing session
      let session = await Session.findOne({ pin });

      // Case 1: New session
      if (!session) {
        session = new Session({
          pin,
          deviceId,
          deviceName,
          socketId: socket.id
        });
        await session.save();
        activeSessions.set(pin, socket.id);
        socket.emit('session-registered', { isNew: true });
        return;
      }

      // Case 2: Existing session - same device
      if (session.deviceId === deviceId) {
        // Force logout any existing connection
        if (activeSessions.has(pin)) {
          const prevSocketId = activeSessions.get(pin);
          const prevSocket = io.sockets.sockets.get(prevSocketId);
          if (prevSocket) {
            prevSocket.emit('force-logout', { 
              reason: 'new-session-same-device',
              newDevice: deviceName
            });
            prevSocket.disconnect(true);
          }
        }

        // Update session
        session.socketId = socket.id;
        await session.save();
        activeSessions.set(pin, socket.id);
        socket.emit('session-registered', { isNew: false, isSameDevice: true });
        return;
      }

      // Case 3: Different device - force logout
      if (activeSessions.has(pin)) {
        const prevSocketId = activeSessions.get(pin);
        const prevSocket = io.sockets.sockets.get(prevSocketId);
        if (prevSocket) {
          prevSocket.emit('force-logout', {
            reason: 'new-session-different-device',
            newDevice: deviceName
          });
          prevSocket.disconnect(true);
        }
      }

      // Update session with new device
      session.deviceId = deviceId;
      session.deviceName = deviceName;
      session.socketId = socket.id;
      await session.save();
      activeSessions.set(pin, socket.id);

      socket.emit('session-registered', {
        isNew: false,
        isSameDevice: false,
        previousDevice: session.deviceName
      });

    } catch (error) {
      console.error('Session registration error:', error);
      socket.emit('session-error', { message: 'Failed to register session' });
    }
  });

  socket.on('disconnect', async () => {
    console.log(`Disconnected: ${socket.id}`);
    // Clean up active sessions
    for (const [pin, sockId] of activeSessions.entries()) {
      if (sockId === socket.id) {
        activeSessions.delete(pin);
        await Session.updateOne(
          { pin, socketId: socket.id },
          { $set: { socketId: null } }
        );
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});