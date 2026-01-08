import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Button,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Linking,
  Animated,
  TouchableWithoutFeedback,
  PanResponder,
  Image,
} from 'react-native';
import { io } from 'socket.io-client';
import LoadingScreen from './components/LoadingScreen';


// --- SERVER CONFIGURATION ---
// OPTION 1: Online Server (Render) - Use this if you don't have a local backend running
const SERVER_URL = 'https://starttalk.onrender.com';

// OPTION 2: Local Server - Uncomment below if running backend locally
// Android Emulator: 'http://10.0.2.2:3000' | iOS Simulator: 'http://localhost:3000'
// Physical Device: 'http://YOUR_PC_IP_ADDRESS:3000' (e.g., 192.168.1.5:3000)
// const SERVER_URL = 'http://10.0.2.2:3000';

const REACTIONS = [
  { id: 1, type: 'emoji', content: '❤️' },
  { id: 2, type: 'emoji', content: '😂' },
  { id: 3, type: 'emoji', content: '😮' },
  { id: 4, type: 'emoji', content: '😢' },
  { id: 5, type: 'emoji', content: '👍' },
  { id: 6, type: 'emoji', content: '👎' },
];

const SwipeableMessage = ({ children, onReply, isReacting }) => {
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Detect horizontal swipe to the right, ignore vertical
        return gestureState.dx > 10 && Math.abs(gestureState.dy) < 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx > 0) {
          translateX.setValue(gestureState.dx * 0.3); // Add resistance
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 50) { // Threshold to trigger reply
          onReply();
        }
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 10,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 10,
        }).start();
      },
    })
  ).current;

  return (
    <Animated.View style={{ 
      transform: [{ translateX }],
      zIndex: isReacting ? 999 : 1, // Fix for iOS/Web: Bring to front when reacting
      elevation: isReacting ? 50 : 0 // Fix for Android: Bring to front when reacting
    }} {...panResponder.panHandlers}>
      {children}
    </Animated.View>
  );
};

export default function App() {
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const [status, setStatus] = useState('Connecting...');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [activeReactionId, setActiveReactionId] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const inputRef = useRef(null);
  const socket = useRef(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(-250)).current;

  useEffect(() => {
    console.log(`Attempting to connect to: ${SERVER_URL}`);
    // Initialize socket connection
    socket.current = io(SERVER_URL, {
      transports: ["websocket"],
      upgrade: false,
      reconnectionAttempts: 5,
      timeout: 60000,
    });

    socket.current.on('connect', () => {
      console.log('Connected to server!');
      // The server will send 'waiting' or 'paired' next
    });

    socket.current.on('connect_error', (err) => {
      console.log('Connection Error:', err.message);
      setStatus(`Connection failed: ${err.message}. Please check SERVER_URL and network.`);
    });
    
    socket.current.on('connect_timeout', () => {
      console.log('Connection timed out.');
      setStatus('Connection timed out. Please check your network.');
    });

    socket.current.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      setStatus(`Disconnected: ${reason}. Reconnecting...`);
    });

    socket.current.on('waiting', () => {
      setStatus('Waiting for a partner...');
      setMessages([]); // Clear previous chat
    });

    socket.current.on('paired', () => {
      setStatus('Chatting with a stranger');
      setMessages([]); // Clear previous chat
    });

    socket.current.on('chat message', (msg) => {
      // Check if this is a reaction update sent as a message
      if (msg.type === 'reaction') {
        setMessages((prevMessages) =>
          prevMessages.map((m) =>
            m.id === msg.messageId ? { ...m, reaction: msg.reaction } : m
          )
        );
        return;
      }

      if (msg.type === 'edit') {
        setMessages((prevMessages) =>
          prevMessages.map((m) =>
            m.id === msg.id ? { ...m, text: msg.text } : m
          )
        );
        return;
      }

      if (msg.type === 'delete') {
        setMessages((prevMessages) =>
          prevMessages.filter((m) => m.id !== msg.id)
        );
        return;
      }

      setMessages((prevMessages) => {
        const incomingId = msg.id || Date.now().toString();
        // Prevent duplicate messages (e.g. if server echoes back our own message)
        if (prevMessages.some(m => m.id === incomingId)) {
          return prevMessages;
        }
        return [
          { 
            id: incomingId, // Use the ID sent by the sender
            text: msg.text ?? msg,
            from: 'Stranger',
            replyTo: msg.replyTo || null, 
            reaction: msg.reaction || null,
          },
          ...prevMessages,
        ];
      });
    });

    socket.current.on('stranger disconnected', () => {
      setStatus('Partner disconnected. Waiting again...');
      setMessages([]);
    });

    // Cleanup on component unmount
    return () => {
      socket.current.disconnect();
    };
  }, []);

  const sendMessage = () => {
    if (text.trim() && socket.current) {
      if (editingMessage) {
        socket.current.emit('chat message', { type: 'edit', id: editingMessage.id, text });
        setMessages((prevMessages) =>
          prevMessages.map((m) =>
            m.id === editingMessage.id ? { ...m, text } : m
          )
        );
        setEditingMessage(null);
        setText('');
      } else {
      const messageId = Date.now().toString(); // Generate ID here
      const messageData = { id: messageId, text, replyTo }; // Send ID to server
      socket.current.emit('chat message', messageData);
      setMessages((prevMessages) => [
        {
          id: messageId,
          text,
          from: 'Me',
          replyTo,
        },
        ...prevMessages,
      ]); 
      setReplyTo(null);
      setText('');
      }
    }
  };

  const skipConnection = () => {
    if (socket.current) {
      socket.current.emit('skip');
      setMessages([]);
      setStatus('Skipping...');
    }
  };

  const toggleMenu = () => {
    if (isMenuOpen) {
      Animated.timing(slideAnim, {
        toValue: -250,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setIsMenuOpen(false));
    } else {
      setIsMenuOpen(true);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  };

  const addReaction = (messageId, reaction) => {
    setMessages((prevMessages) =>
      prevMessages.map((msg) =>
        msg.id === messageId ? { ...msg, reaction } : msg
      )
    );
    setActiveReactionId(null);
    // Emit the reaction to the server so the other user sees it
    if (socket.current) {
      // Send as a 'chat message' so the server broadcasts it like a normal message
      socket.current.emit('chat message', { type: 'reaction', messageId, reaction });
    }
  };

  const startEditing = (item) => {
    setText(item.text);
    setEditingMessage(item);
    setActiveReactionId(null);
    inputRef.current?.focus();
  };

  const deleteMessage = (itemId) => {
    setMessages((prev) => prev.filter((m) => m.id !== itemId));
    if (socket.current) {
      socket.current.emit('chat message', { type: 'delete', id: itemId });
    }
    setActiveReactionId(null);
  };

  const renderItem = ({ item }) => {
    const isMe = item.from === 'Me';
    const isReacting = activeReactionId === item.id;

    return (
      <SwipeableMessage
        onReply={() =>
          setReplyTo({
            id: item.id,
            text: item.text,
            from: item.from,
          })
        }
        isReacting={isReacting}
      >
      <TouchableOpacity
        activeOpacity={0.8}
        onLongPress={() => setActiveReactionId(isReacting ? null : item.id)}
      >
        <View style={[styles.messageContainer, isMe ? styles.myContainer : styles.theirContainer, { zIndex: isReacting ? 999 : 1 }]}>
          
          {isReacting && (
            <View style={[styles.menuWrapper, isMe ? { right: 0, alignItems: 'flex-end' } : { left: 0, alignItems: 'flex-start' }]}>
              <View style={styles.reactionPicker}>
              {REACTIONS.map((r) => (
                <TouchableOpacity key={r.id} onPress={() => addReaction(item.id, r)} style={styles.reactionItem}>
                  {r.type === 'emoji' ? (
                    <Text style={styles.reactionText}>{r.content}</Text>
                  ) : (
                    <Image source={r.content} style={styles.reactionImage} />
                  )}
                </TouchableOpacity>
              ))}
              </View>
              <View style={styles.optionsContainer}>
                {isMe && (
                  <TouchableOpacity onPress={() => startEditing(item)} style={styles.optionButton}>
                    <Text style={styles.optionText}>Edit</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => deleteMessage(item.id)} style={styles.optionButton}>
                  <Text style={[styles.optionText, { color: '#FF3B30' }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={[styles.bubble, isMe ? styles.myBubble : styles.theirBubble]}>

            {/* REPLY PREVIEW */}
            {item.replyTo && (
              <View style={styles.replyPreview}>
                <Text style={styles.replySender}>
                  {item.replyTo.from === 'Me' ? 'You' : 'Stranger'}
                </Text>
                <Text style={styles.replyText} numberOfLines={1}>
                  {item.replyTo.text}
                </Text>
              </View>
            )}

            <Text style={isMe ? styles.myText : styles.theirText}>
              {item.text}
            </Text>

            {item.reaction && (
              <View style={styles.reactionBadge}>
                {item.reaction.type === 'emoji' ? (
                  <Text style={styles.reactionBadgeText}>{item.reaction.content}</Text>
                ) : (
                  <Image source={item.reaction.content} style={styles.reactionBadgeImage} />
                )}
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
      </SwipeableMessage>
    );
  };

  if (isSplashVisible) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <LoadingScreen
          isLoaded={true}
          onComplete={() => setIsSplashVisible(false)}
        />
        <View style={styles.privacyContainer} pointerEvents="box-none">
          <Text style={styles.privacyText}>
            By using this app, you agree to our{' '}
            <Text
              style={styles.privacyLink}
              onPress={() => {
                Linking.openURL('https://nikhilverma1420.github.io/starttalk-privacy-policy/')
                  .catch(err => console.error("Failed to open URL:", err));
              }}
            >
              Privacy Policy
            </Text>
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f5f5' }}>
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <Text style={styles.status}>{status}</Text>
      <FlatList
        style={styles.messageList}
        data={messages}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        inverted // To show latest messages at the bottom
        removeClippedSubviews={false} // Important: allows the picker to overflow visible bounds
        CellRendererComponent={({ index, children, style, ...props }) => {
          const item = messages[index];
          const isReacting = item && item.id === activeReactionId;
          // Apply zIndex to the cell wrapper to ensure it sits above siblings
          return (
            <View {...props} style={[style, { zIndex: isReacting ? 9999 : 1, elevation: isReacting ? 50 : 0 }]}>
              {children}
            </View>
          );
        }}
      />
      {replyTo && (
        <View style={styles.replyBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.replyingTo}>
              Replying to {replyTo.from === 'Me' ? 'You' : 'Stranger'}
            </Text>
            <Text numberOfLines={1}>{replyTo.text}</Text>
          </View>

          <TouchableOpacity onPress={() => setReplyTo(null)}>
            <Text style={styles.closeReply}>✕</Text>
          </TouchableOpacity>
        </View>
        )}

      {status.startsWith('Chatting') && (
        <View style={styles.inputContainer}>
          <TouchableOpacity onPress={skipConnection} style={styles.skipButton}>
            <Text style={styles.buttonText}>Skip</Text>
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
            onSubmitEditing={sendMessage}
            returnKeyType="send"
          />
          <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
            <Text style={styles.buttonText}>{editingMessage ? 'Update' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>

    <TouchableOpacity style={styles.menuIcon} onPress={toggleMenu}>
      <Text style={styles.menuIconText}>☰</Text>
    </TouchableOpacity>

    {isMenuOpen && (
      <TouchableWithoutFeedback onPress={toggleMenu}>
        <View style={styles.menuOverlay} />
      </TouchableWithoutFeedback>
    )}

    <Animated.View
      style={[styles.sideMenu, { transform: [{ translateX: slideAnim }] }]}
      pointerEvents={isMenuOpen ? 'auto' : 'none'}
    >
      <Text style={styles.menuTitle}>StartTalk</Text>
      <TouchableOpacity onPress={() => {
        Linking.openURL('https://nikhilverma1420.github.io/starttalk-privacy-policy/')
          .catch(err => console.error("Failed to open URL:", err));
      }}>
        <Text style={styles.menuItem}>Privacy Policy</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => {
        Linking.openURL('https://nikhilverma1420.github.io/starttalk-privacy-policy/terms.html')
          .catch(err => console.error("Failed to open URL:", err));
      }}>
        <Text style={styles.menuItem}>Terms of use</Text>
      </TouchableOpacity>
    </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: 40, // Add padding for status bar
    paddingBottom: 10,
    paddingHorizontal: 10,
  },
  status: {
    fontSize: 18,
    textAlign: 'center',
    paddingVertical: 10,
    color: '#666',
  },
  messageList: {
    flex: 1,
  },
  messageContainer: {
    marginVertical: 5,
    flexDirection: 'row',
    width: '100%',
  },
  myContainer: {
    justifyContent: 'flex-end',
  },
  theirContainer: {
    justifyContent: 'flex-start',
  },
  bubble: {
    padding: 12,
    borderRadius: 20,
    maxWidth: '80%',
  },
  myBubble: {
    backgroundColor: '#007AFF', // Modern Blue
    borderBottomRightRadius: 4,
  },
  theirBubble: {
    backgroundColor: '#E5E5EA', // Light Gray
    borderBottomLeftRadius: 4,
  },
  myText: {
    color: '#fff',
    fontSize: 16,
  },
  theirText: {
    color: '#000',
    fontSize: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 10,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
    fontSize: 16,
  },
  skipButton: {
    backgroundColor: '#FF3B30',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 20,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  privacyContainer: {
    position: 'absolute',
    bottom: 30,
    width: '100%',
    alignItems: 'center',
    zIndex: 9999,
    elevation: 99,
  },
  menuIcon: {
    position: 'absolute',
    top: 45,
    left: 20,
    zIndex: 50,
    padding: 5,
  },
  menuIconText: {
    fontSize: 30,
    color: '#333',
  },
  menuOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 100,
  },
  sideMenu: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 250,
    backgroundColor: '#fff',
    zIndex: 101,
    paddingTop: 60,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  menuTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    color: '#333',
  },
  menuItem: {
    fontSize: 18,
    color: '#007AFF',
    paddingVertical: 10,
  },
  privacyText: {
    color: '#fff',
    fontSize: 12,
  },
  privacyLink: {
    textDecorationLine: 'underline',
    fontWeight: 'bold',
  },
  replyPreview: {
    backgroundColor: '#ddd',
    padding: 6,
    borderRadius: 6,
    marginBottom: 4,
  },
  replySender: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#444',
  },
  replyText: {
    fontSize: 12,
    color: '#555',
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#eee',
  },

  replyingTo: {
    fontWeight: 'bold',
    fontSize: 12,
  },

  closeReply: {
    fontSize: 18,
    paddingHorizontal: 10,
  },
  menuWrapper: {
    position: 'absolute',
    bottom: '100%',
    marginBottom: 5,
    zIndex: 1000,
  },
  reactionPicker: {
    backgroundColor: '#fff',
    borderRadius: 30,
    padding: 8,
    flexDirection: 'row',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    marginBottom: 8,
  },
  optionsContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 4,
    flexDirection: 'row',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  optionButton: {
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  optionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  reactionItem: {
    marginHorizontal: 5,
  },
  reactionText: {
    fontSize: 24,
  },
  reactionImage: {
    width: 24,
    height: 24,
  },
  reactionBadge: {
    position: 'absolute',
    bottom: -10,
    right: -5,
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
    elevation: 2,
  },
  reactionBadgeText: {
    fontSize: 12,
  },
  reactionBadgeImage: {
    width: 14,
    height: 14,
  },
});
