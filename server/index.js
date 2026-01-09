const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

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


let waitingQueue = [];

const matchUsers = () => {
  // Filter out disconnected users to prevent ghost matches
  waitingQueue = waitingQueue.filter(s => s.connected);

  while (waitingQueue.length >= 2) {
    const user1 = waitingQueue.shift();
    const user2 = waitingQueue.shift();

    // Prevent self-matching (sanity check)
    if (user1.id === user2.id) {
      waitingQueue.push(user1);
      continue;
    }

    // Create a private room for the pair
    const room = `${user1.id}#${user2.id}`;
    user1.join(room);
    user2.join(room);

    // Store partner and room info on each socket
    user1.room = room;
    user2.room = room;
    user1.partner = user2.id;
    user2.partner = user1.id;

    // Notify both users they are paired
    io.to(room).emit('paired');
    
    // Send push notification to both users if they are backgrounded
    if (user1.expoPushToken && user1.isBackground) {
      sendExpoPush(user1.expoPushToken, 'Found a Stranger!', 'A stranger is waiting. Come back to chat!', { type: 'paired' });
    }
    if (user2.expoPushToken && user2.isBackground) {
      sendExpoPush(user2.expoPushToken, 'Found a Stranger!', 'A stranger is waiting. Come back to chat!', { type: 'paired' });
    }
    
    console.log(`Paired ${user1.id} and ${user2.id} in room ${room}`);
  }
};

io.on('connection', (socket) => {
  console.log("CONNECTED FROM:", socket.handshake.address);
  console.log('A user connected:', socket.id);
  waitingQueue.push(socket);
  socket.emit('waiting');
  matchUsers();

  // Handle incoming chat messages
  socket.on('chat message', (msg) => {
    if (socket.room) {
      socket.to(socket.room).emit('chat message', msg);

      // Try to notify the partner via push if they have registered a token and are backgrounded
      try {
        const partnerId = socket.partner;
        if (partnerId) {
          const partnerSocket = io.sockets.sockets.get(partnerId);
          if (partnerSocket && partnerSocket.expoPushToken && partnerSocket.isBackground) {
            const title = 'New message';
            const body = typeof msg === 'string' ? msg : (msg.text || 'You have a new message');
            sendExpoPush(partnerSocket.expoPushToken, title, body, { type: 'chat', from: socket.id });
          }
        }
      } catch (err) {
        console.error('Error sending push to partner:', err);
      }
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
    console.log('User skipped:', socket.id);

    const partnerId = socket.partner;
    const roomId = socket.room;

    // 1. Handle the partner (if any)
    if (partnerId) {
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        // Notify and reset partner
        partnerSocket.emit('stranger disconnected');
        partnerSocket.leave(roomId);
        delete partnerSocket.partner;
        delete partnerSocket.room;

        // Put partner back in queue (if not already there)
        if (!waitingQueue.find(s => s.id === partnerSocket.id)) {
          waitingQueue.push(partnerSocket);
          partnerSocket.emit('waiting');
        }
      }
    }

    // 2. Reset the skipper (current user)
    socket.leave(roomId);
    delete socket.partner;
    delete socket.room;

    // Put skipper back in queue (ensure no duplicates)
    if (!waitingQueue.find(s => s.id === socket.id)) {
      waitingQueue.push(socket);
    }
    socket.emit('waiting');
    
    matchUsers();
  });

  // Handle user disconnection
  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    
    // If the user was in a pair
    if (socket.partner) {
      const partnerSocket = io.sockets.sockets.get(socket.partner);
      if (partnerSocket) {
        // Notify the partner
        partnerSocket.emit('stranger disconnected');
        
        // Clean up partner's state and put them back in the queue
        partnerSocket.leave(socket.room);
        delete partnerSocket.partner;
        delete partnerSocket.room;
        
        if (!waitingQueue.find(s => s.id === partnerSocket.id)) {
          waitingQueue.push(partnerSocket);
          partnerSocket.emit('waiting');
          console.log(`User ${partnerSocket.id} is back in the queue.`);
        }
        matchUsers();
      }
    }

    // Clean up queue if the disconnecting user was waiting
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on :${PORT}`);
});
