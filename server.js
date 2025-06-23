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
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true
  }
});

// Active sessions map for quick lookup
const activeSessions = new Map();

// Middleware
app.use(cors());
app.use(express.json());

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  socket.on('register-session', async ({ pin, deviceId, deviceName }) => {
    try {
      // Find or create session
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

      // Case 2: Existing session
      activeSessions.set(pin, socket.id);

      // If same device, update socket ID
      if (session.deviceId === deviceId) {
        session.socketId = socket.id;
        await session.save();
        socket.emit('session-registered', { isNew: false, isSameDevice: true });
        return;
      }

      // Case 3: Different device - force logout previous
      if (session.socketId) {
        const prevSocket = io.sockets.sockets.get(session.socketId);
        if (prevSocket) {
          prevSocket.emit('force-logout', { 
            reason: 'logged-in-elsewhere',
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
    // Clean up session references
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

  // Heartbeat to detect dead connections
  socket.on('heartbeat', () => {
    socket.emit('heartbeat-ack');
  });
});

// Heartbeat interval to check for dead connections
setInterval(() => {
  const now = Date.now();
  io.sockets.sockets.forEach(socket => {
    if (socket.lastHeartbeat && (now - socket.lastHeartbeat > 30000)) {
      socket.disconnect(true);
    }
  });
}, 10000);

server.listen(process.env.PORT || 5000, () => {
  console.log(`Server running on port ${process.env.PORT || 5000}`);
});