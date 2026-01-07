const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity in development
  }
});

const PORT = 3000;

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
    console.log(`Paired ${user1.id} and ${user2.id} in room ${room}`);
  }
};

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  waitingQueue.push(socket);
  socket.emit('waiting');
  matchUsers();

  // Handle incoming chat messages
  socket.on('chat message', (msg) => {
    if (socket.room) {
      socket.to(socket.room).emit('chat message', msg);
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

server.listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
