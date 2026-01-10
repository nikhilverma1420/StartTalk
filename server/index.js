const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const mongoose = require('mongoose');
const chatManager = require('./chatManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
  transports: ["websocket"],
  allowUpgrades: false,
});

const fetch = require('node-fetch');

// Helper to send an Expo push notification
const sendExpoPush = async (expoPushToken, title, body, data = {}) => {
  if (!expoPushToken) return;
  const message = {
    to: expoPushToken,
    sound: 'default',
    title,
    body,
    data,
  };

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message),
    });
    const json = await res.json();
    console.log('Expo push response:', json);
  } catch (err) {
    console.error('Failed to send Expo push:', err);
  }
};

const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// User schema with TTL index
const userSchema = new mongoose.Schema({
  userId: { type: String, unique: true, required: true },
  expoPushToken: { type: String },
  isOnline: { type: Boolean, default: false },
  currentChatId: { type: String },
  updatedAt: { type: Date, default: Date.now }
});
userSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });
const User = mongoose.model('User', userSchema);

// Init chat manager
chatManager.init(User, io);

// Init chat manager
chatManager.init(User, io);


io.on('connection', (socket) => {
  console.log("CONNECTED FROM:", socket.handshake.address);
  console.log('A user connected:', socket.id);

  socket.on('findPartner', () => {
    if (!chatManager.waitingQueue.find(s => s.id === socket.id)) {
      chatManager.waitingQueue.push(socket);
      socket.emit('waiting');
      chatManager.matchUsers();
    }
  });

  // Register user with push token
  socket.on('register', async (data) => {
    try {
      const { userId, expoPushToken } = data;
      await User.findOneAndUpdate(
        { userId },
        { expoPushToken, isOnline: true, updatedAt: new Date() },
        { upsert: true, new: true }
      );
      socket.userId = userId;
      console.log(`User ${userId} registered`);
    } catch (err) {
      console.error('Error registering user:', err);
    }
  });

  // Rejoin chat
  socket.on('rejoin', (data) => {
    chatManager.handleRejoin(socket, data.chatId);
  });

  // Handle incoming chat messages
  socket.on('chat message', async (msg) => {
    if (socket.room) {
      socket.to(socket.room).emit('chat message', msg);
      chatManager.saveMessage(socket.room, msg);

      // Check if partner needs a push notification
      try {
        // We cannot rely solely on socket.partner because if they disconnected, that socket ID is invalid.
        // We look up the partner via the User model using the currentChatId.
        const partnerUser = await User.findOne({ 
          currentChatId: socket.room, 
          userId: { $ne: socket.userId } // Find the user who is NOT me
        });

        if (partnerUser) {
          let shouldSendPush = false;

          // 1. Partner is offline (disconnected)
          if (!partnerUser.isOnline) {
            shouldSendPush = true;
          } 
          // 2. Partner is online but in background
          else {
            // Check activeChats to find their socket object
            const chat = chatManager.activeChats.get(socket.room);
            const partnerSocket = chat?.users.find(u => u.userId === partnerUser.userId);
            
            // If socket is marked as background, or if we can't find the socket despite DB saying online
            if (partnerSocket?.isBackground || !partnerSocket) {
              shouldSendPush = true;
            }
          }

          if (shouldSendPush) {
            const title = 'New message';
            const body = typeof msg === 'string' ? msg : (msg.text || 'You have a new message');
            sendExpoPush(partnerUser.expoPushToken, title, body, { type: 'chat', from: socket.id, chatId: socket.room });
          }
        }
      } catch (err) {
        console.error('Error sending push to partner:', err);
      }
    } else {
      console.warn(`Socket ${socket.id} sent message but has no room! Message not saved.`);
    }
  });

  // Track app state (foreground/background)
  socket.on('appState', (data) => {
    socket.isBackground = data.isBackground;
    console.log('User', socket.id, 'app state:', data.isBackground ? 'background' : 'foreground');
  });

  // Allow clients to register their Expo push token
  socket.on('registerPushToken', (token) => {
    console.log('Register push token for', socket.id, token);
    socket.expoPushToken = token;
  });

  // Handle typing status
  socket.on('typing', () => {
    if (socket.room) {
      socket.to(socket.room).emit('typing');
    }
  });

  socket.on('stop typing', () => {
    if (socket.room) {
      socket.to(socket.room).emit('stop typing');
    }
  });

  // Handle skip
  socket.on('skip', () => {
    chatManager.handleSkip(socket);
  });

  // Handle user disconnection
  socket.on('disconnect', async () => {
    console.log('A user disconnected:', socket.id);
    
    // Handle chat disconnect
    chatManager.handleDisconnect(socket);
    
    // Update online status in DB
    if (socket.userId) {
      try {
        await User.findOneAndUpdate(
          { userId: socket.userId },
          { isOnline: false, updatedAt: new Date() }
        );
      } catch (err) {
        console.error('Error updating user offline:', err);
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on :${PORT}`);
});
