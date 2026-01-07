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
} from 'react-native';
import { io } from 'socket.io-client';
import LoadingScreen from './components/LoadingScreen';

// --- IMPORTANT ---
// Replace this with your computer's local IP address.
// On Windows, run `ipconfig` in cmd.exe and look for 'IPv4 Address'.
// On macOS/Linux, run `ifconfig` or `ip a` and find the IP address.
const SERVER_URL = 'http://192.168.0.122:3000';

export default function App() {
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const [status, setStatus] = useState('Connecting...');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const socket = useRef(null);

  useEffect(() => {
    console.log(`Attempting to connect to: ${SERVER_URL}`);
    // Initialize socket connection
    socket.current = io(SERVER_URL, {
      reconnectionAttempts: 5,
      timeout: 10000,
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
      setMessages((prevMessages) => [
        { id: Date.now().toString(), text: msg, from: 'Stranger' },
        ...prevMessages,
      ]);
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
      socket.current.emit('chat message', text);
      setMessages((prevMessages) => [
        { id: Date.now().toString(), text, from: 'Me' },
        ...prevMessages,
      ]);
      setText('');
    }
  };

  const skipConnection = () => {
    if (socket.current) {
      socket.current.emit('skip');
      setMessages([]);
      setStatus('Skipping...');
    }
  };

  const renderItem = ({ item }) => {
    const isMe = item.from === 'Me';
    return (
      <View style={[styles.messageContainer, isMe ? styles.myContainer : styles.theirContainer]}>
        <View style={[styles.bubble, isMe ? styles.myBubble : styles.theirBubble]}>
          <Text style={isMe ? styles.myText : styles.theirText}>{item.text}</Text>
        </View>
      </View>
    );
  };

  if (isSplashVisible) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <LoadingScreen
          isLoaded={true}
          onComplete={() => setIsSplashVisible(false)}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
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
      />
      {status.startsWith('Chatting') && (
        <View style={styles.inputContainer}>
          <TouchableOpacity onPress={skipConnection} style={styles.skipButton}>
            <Text style={styles.buttonText}>Skip</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Type a message..."
          />
          <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
            <Text style={styles.buttonText}>Send</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
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
});
