const { v4: uuidv4 } = require('uuid');

// Import User model (assuming it's defined in index.js)
let User;
let io;
let waitingQueue = [];
let activeChats = new Map(); // chatId -> { roomId, users: [socket1, socket2], timeout }

function init(_User, _io) {
  User = _User;
  io = _io;
}

function generateChatId() {
  return uuidv4();
}

function matchUsers() {
  console.log('matchUsers called, waitingQueue length:', waitingQueue.length);
  // Filter out disconnected users
  // waitingQueue = waitingQueue.filter(s => s.connected);

  while (waitingQueue.length >= 2) {
    const user1 = waitingQueue.shift();
    const user2 = waitingQueue.shift();

    const roomId = generateChatId();
    const chatId = roomId; // Use roomId as chatId

    user1.join(roomId);
    user2.join(roomId);
    user1.room = roomId;
    user2.room = roomId;
    user1.partner = user2.id;
    user2.partner = user1.id;

    // Store in DB
    User.findOneAndUpdate({ userId: user1.userId }, { currentChatId: chatId });
    User.findOneAndUpdate({ userId: user2.userId }, { currentChatId: chatId });

    // Store active chat
    activeChats.set(chatId, {
      roomId,
      users: [user1, user2],
      timeout: null,
      messages: []
    });

    user1.emit('paired', { chatId });
    user2.emit('paired', { chatId });

    console.log(`Paired ${user1.id} and ${user2.id} in room ${roomId}`);
  }
}

function saveMessage(chatId, message) {
  const chat = activeChats.get(chatId);
  if (chat) {
    if (message.type === 'edit') {
      const existing = chat.messages.find(m => m.id === message.id);
      if (existing) existing.text = message.text;
    } else if (message.type === 'delete') {
      chat.messages = chat.messages.filter(m => m.id !== message.id);
    } else if (message.type === 'reaction') {
      const existing = chat.messages.find(m => m.id === message.messageId);
      if (existing) existing.reaction = message.reaction;
    } else {
      chat.messages.push(message);
      console.log(`Saved message for chat ${chatId}. Total messages: ${chat.messages.length}`);
    }
  }
}

function handleDisconnect(socket) {
  const chatId = activeChats.get(socket.room)?.roomId;
  if (chatId) {
    const chat = activeChats.get(chatId);
    if (chat) {
      // Remove the disconnected user
      chat.users = chat.users.filter(s => s.id !== socket.id);

      if (chat.users.length > 0) {
        // At least one user left. Keep chat alive for a grace period.
        // We do NOT put them back in the queue yet.
        
        const remaining = chat.users[0];
        const timeoutDuration = 5 * 60 * 1000; // 5 min
        remaining.emit('partner paused', { timeout: timeoutDuration });
        
        // Clear existing timeout if any
        if (chat.timeout) clearTimeout(chat.timeout);
        
        // Set timeout to end chat eventually if user doesn't return
        chat.timeout = setTimeout(() => {
          // If chat still exists and partner didn't return, now we end it
          if (chat.users.length > 0) {
            const remaining = chat.users[0];
            remaining.emit('stranger disconnected');
            waitingQueue.push(remaining); // NOW we re-queue the remaining user
            remaining.emit('waiting');
          }
          endChat(chatId);
        }, 5 * 60 * 1000); // 5 min
      } else {
        // Both disconnected. Keep session briefly in case of quick network blip, or end.
        // For now, we'll end it to keep it simple, or you can add a timeout here too.
        if (chat.timeout) clearTimeout(chat.timeout);
        chat.timeout = setTimeout(() => endChat(chatId), 2 * 60 * 1000);
      }
    }
  }

  // Remove from queue if waiting
  const index = waitingQueue.findIndex(s => s.id === socket.id);
  if (index !== -1) {
    waitingQueue.splice(index, 1);
  }
}

function handleRejoin(socket, chatId) {
  const chat = activeChats.get(chatId);
  
  // Allow rejoin if chat exists and has space (< 2 users)
  if (chat && chat.users.length < 2) {
    // Clear destruction timeout since user returned
    if (chat.timeout) {
      clearTimeout(chat.timeout);
      chat.timeout = null;
    }

    // Remove this socket from waitingQueue (because index.js added it on connection)
    const index = waitingQueue.findIndex(s => s.id === socket.id);
    if (index !== -1) {
      waitingQueue.splice(index, 1);
    }

    socket.join(chat.roomId);
    socket.room = chat.roomId;
    
    // Link partners if the other user is there
    if (chat.users.length > 0) {
      const partnerSocket = chat.users[0];
      socket.partner = partnerSocket.id;
      partnerSocket.partner = socket.id;
      partnerSocket.emit('partner rejoined');
    }

    chat.users.push(socket);

    // Update DB
    User.findOneAndUpdate({ userId: socket.userId }, { currentChatId: chatId });

    socket.emit('rejoined', { chatId });
    socket.emit('chat history', chat.messages);

    console.log(`Sent history (${chat.messages.length} msgs) to ${socket.id}`);
    console.log(`User ${socket.id} rejoined chat ${chatId}`);
  } else {
    socket.emit('rejoin failed');
  }
}

function endChat(chatId) {
  const chat = activeChats.get(chatId);
  if (chat) {
    chat.users.forEach(s => {
      s.leave(chat.roomId);
      delete s.room;
      delete s.partner;
      // Clear DB
      User.findOneAndUpdate({ userId: s.userId }, { currentChatId: null });
    });
    if (chat.timeout) clearTimeout(chat.timeout);
    activeChats.delete(chatId);
  }
}

function handleSkip(socket) {
  const chatId = socket.room;
  if (chatId) {
    const chat = activeChats.get(chatId);
    let usersToRequeue = [];

    if (chat) {
      usersToRequeue = [...chat.users];
    }
    // Ensure the user skipping is also requeued (in case of desync or chat not found)
    if (!usersToRequeue.find(u => u.id === socket.id)) {
      usersToRequeue.push(socket);
    }

    endChat(chatId);
    
    usersToRequeue.forEach(s => {
      if (!waitingQueue.find(wq => wq.id === s.id)) {
        waitingQueue.push(s);
      }
      s.emit('waiting');
    });

    matchUsers();
  }
}

module.exports = {
  init,
  matchUsers,
  handleDisconnect,
  handleRejoin,
  handleSkip,
  waitingQueue,
  saveMessage
};