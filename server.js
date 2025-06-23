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
    origin: [
      process.env.FRONTEND_URL,
      "http://localhost:3000",
      "https://client-socket-1xdm.vercel.app" 
    ],
    methods: ["GET", "POST"]
  }
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
      // Find existing session for this PIN
      const existingSession = await Session.findOne({ pin });

      if (!existingSession) {
        socket.emit('invalid-pin', { message: 'No session found for this PIN' });
        return;
      }

      // If same device but different socket (new tab/window)
      if (existingSession.deviceId === deviceId) {
        if (existingSession.socketId && existingSession.socketId !== socket.id) {
          // Notify previous socket to logout
          io.to(existingSession.socketId).emit('force-logout', {
            message: 'Logged out from same device - new session',
            newDevice: deviceName,
            isSameDevice: true
          });
        }

        // Update session with new socket ID
        existingSession.socketId = socket.id;
        await existingSession.save();

        socket.emit('pin-registered', {
          message: 'Session updated for same device',
          isSameDevice: true
        });
        return;
      }

      // Different device - handle auto-logout
      if (existingSession.socketId) {
        // Get the previous device's socket
        const previousSocket = io.sockets.sockets.get(existingSession.socketId);
        
        if (previousSocket) {
          // Send force-logout to previous device
          previousSocket.emit('force-logout', {
            message: 'Logged out from another device',
            newDevice: deviceName,
            isSameDevice: false,
            newDeviceDetails: { deviceId, deviceName }
          });

          // Wait a moment to ensure message is delivered
          await new Promise(resolve => setTimeout(resolve, 500));
        }
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