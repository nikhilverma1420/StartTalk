import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  Button,
  FlatList,
  Platform,
  TouchableOpacity,
  Linking,
  Animated,
  TouchableWithoutFeedback,
  PanResponder,
  Image,
  Keyboard,
  AppState,
  Alert,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { io } from 'socket.io-client';
import LoadingScreen from './components/LoadingScreen';

// Set notification handler for foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});


// --- SERVER CONFIGURATION ---
// OPTION 1: Online Server (Render) - Use this if you don't have a local backend running
//const SERVER_URL = 'https://start-talk-production.up.railway.app';

// OPTION 2: Local Server - Uncomment below if running backend locally
// Android Emulator: 'http://10.0.2.2:3000' | iOS Simulator: 'http://localhost:3000'
// Physical Device: 'http://YOUR_PC_IP_ADDRESS:3000' (e.g., 192.168.1.5:3000)
const SERVER_URL = 'http://192.168.0.122:3000';

const REACTIONS = [
  { id: 1, type: 'emoji', content: '❤️' },
  { id: 2, type: 'emoji', content: '😂' },
  { id: 3, type: 'emoji', content: '😮' },
  { id: 4, type: 'emoji', content: '😢' },
  { id: 5, type: 'emoji', content: '👍' },
  { id: 6, type: 'emoji', content: '👎' },
];

const SwipeableMessage = ({ children, onReply, isReacting, isMe }) => {
  const translateX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Detect horizontal swipe, ignore vertical
        const isHorizontal = Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 10;
        if (!isHorizontal) return false;

        // If it's me, swipe Right to Left (dx < 0). If stranger, swipe Left to Right (dx > 0)
        return isMe ? gestureState.dx < -10 : gestureState.dx > 10;
      },
      onPanResponderMove: (_, gestureState) => {
        if (isMe && gestureState.dx < 0) {
          translateX.setValue(gestureState.dx * 0.3); // Add resistance
        } else if (!isMe && gestureState.dx > 0) {
          translateX.setValue(gestureState.dx * 0.3); // Add resistance
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        const triggered = isMe ? gestureState.dx < -50 : gestureState.dx > 50;
        if (triggered) { // Threshold to trigger reply
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

function MainApp() {
  const [isSplashVisible, setIsSplashVisible] = useState(true);
  const [status, setStatus] = useState('Connecting...');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [activeReactionId, setActiveReactionId] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);
  const typingTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const socket = useRef(null);
  const [userId, setUserId] = useState('');
  const [chatId, setChatId] = useState(null);
  const userIdRef = useRef('');
  const chatIdRef = useRef(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(-250)).current;
  const keyboardHeight = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const [keyboardSpace, setKeyboardSpace] = useState(0);
  const flatListRef = useRef(null);
  const [inputBarHeight, setInputBarHeight] = useState(0);
  const [appState, setAppState] = useState(AppState.currentState);
  const appStateRef = useRef(AppState.currentState);
  const [isPartnerPaused, setIsPartnerPaused] = useState(false);
  const [pauseCountdown, setPauseCountdown] = useState(0);

  useEffect(() => {
    console.log(`Attempting to connect to: ${SERVER_URL}`);
    const loadUserId = async () => {
      try {
        let id = await AsyncStorage.getItem('userId');
        if (!id) {
          id = Math.random().toString(36).substr(2, 9);
          await AsyncStorage.setItem('userId', id);
        }
        setUserId(id);
        userIdRef.current = id;
      } catch (err) {
        console.error('Error loading userId:', err);
        const id = Math.random().toString(36).substr(2, 9);
        setUserId(id);
        userIdRef.current = id;
      }
    };
    const loadChatId = async () => {
      try {
        const stored = await AsyncStorage.getItem('chatId');
        if (stored) {
          setChatId(stored);
          chatIdRef.current = stored;
          // If socket connected before storage loaded, emit rejoin now
          if (socket.current && socket.current.connected) {
            socket.current.emit('rejoin', { chatId: stored });
          }
        }
      } catch (err) {
        console.error('Error loading chatId:', err);
      }
    };
    loadUserId();
    loadChatId();
    // Initialize socket connection
    socket.current = io(SERVER_URL, {
      transports: ["websocket"],
      upgrade: false,
      reconnectionAttempts: 5,
      timeout: 60000,
    });

    socket.current.on('connect', () => {
      console.log('Connected to server!');
      if (chatIdRef.current) {
        socket.current.emit('rejoin', { chatId: chatIdRef.current });
      } else {
        socket.current.emit('findPartner');
      }
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
      // Keep messages visible until new partner is found
      setIsPartnerTyping(false);
    });

    socket.current.on('paired', (data) => {
      setStatus('Chatting with a stranger');
      setIsPartnerTyping(false);
      setMessages([{
        id: 'system-join-' + Date.now(),
        text: 'Stranger joined',
        type: 'system',
      }]);
      if (data && data.chatId) {
        setChatId(data.chatId);
        AsyncStorage.setItem('chatId', data.chatId).catch(err => console.error('Error saving chatId:', err));
        chatIdRef.current = data.chatId;
      }
      // Show local notification when match found if in background
      if (appStateRef.current === 'background') {
        Notifications.scheduleNotificationAsync({
          content: {
            title: 'Match Found!',
            body: 'You found a stranger. Come back to chat!',
            sound: 'default',
          },
          trigger: { seconds: 1 },
        }).catch(err => console.error('Error scheduling notification:', err));
      }
    });

    socket.current.on('partner paused', (data) => {
      setStatus('Stranger is offline');
      setIsPartnerPaused(true);
      setPauseCountdown(Math.floor(data.timeout / 1000));
    });

    socket.current.on('partner rejoined', () => {
      setStatus('Chatting with a stranger');
      setIsPartnerPaused(false);
      setPauseCountdown(0);
    });

    socket.current.on('rejoined', (data) => {
      setStatus('Chatting with a stranger');
      setIsPartnerTyping(false);
      if (data && data.chatId) {
        setChatId(data.chatId);
        AsyncStorage.setItem('chatId', data.chatId).catch(err => console.error('Error saving chatId:', err));
        chatIdRef.current = data.chatId;
      }
    });

    socket.current.on('rejoin failed', () => {
      setChatId(null);
      chatIdRef.current = null;
      AsyncStorage.removeItem('chatId').catch(err => console.error('Error removing chatId:', err));
      setStatus('Waiting for a partner...');
      socket.current.emit('findPartner');
    });

    socket.current.on('chat history', (history) => {
      const formattedMessages = history.map(msg => ({
        id: msg.id,
        text: msg.text,
        userId: msg.userId, // Store userId directly
        replyTo: msg.replyTo,
        reaction: msg.reaction
      })).reverse();
      setMessages(formattedMessages);
    });

    socket.current.on('chat message', (msg) => {
      // Check if this is a reaction update sent as a message
      setIsPartnerTyping(false); // Hide typing indicator when message received
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
            id: incomingId,
            text: msg.text ?? msg,
            userId: msg.userId, // Store userId directly
            replyTo: msg.replyTo || null,
            reaction: msg.reaction || null,
          },
          ...prevMessages,
        ];
      });
    });

    socket.current.on('typing', () => {
      setIsPartnerTyping(true);
    });

    socket.current.on('stop typing', () => {
      setIsPartnerTyping(false);
    });

    socket.current.on('stranger disconnected', () => {
      setStatus('Partner disconnected. Waiting again...');
      setMessages((prevMessages) => 
        prevMessages.map((msg) => 
          msg.type === 'system' && msg.text === 'Stranger joined'
            ? { ...msg, text: 'Stranger left' }
            : msg
        )
      );
      setIsPartnerTyping(false);
      setIsPartnerPaused(false);
      setChatId(null);
      chatIdRef.current = null;
      AsyncStorage.removeItem('chatId').catch(err => console.error('Error removing chatId:', err));
    });

    // Cleanup on component unmount
    return () => {
      socket.current.disconnect();
    };
  }, []);

  // Countdown timer for paused partner
  useEffect(() => {
    let interval;
    if (isPartnerPaused && pauseCountdown > 0) {
      interval = setInterval(() => {
        setPauseCountdown((prev) => prev > 0 ? prev - 1 : 0);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPartnerPaused, pauseCountdown]);

  // Register for push notifications and send token to server
  useEffect(() => {
    const registerForPush = async () => {
      if (!Constants.isDevice) {
        console.log('Must use physical device for Push Notifications');
        return;
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Please enable notifications to receive messages from strangers when you are away.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() }
          ]
        );
        console.log('Failed to get push token for push notification!');
        return;
      }

      try {
        const tokenData = await Notifications.getExpoPushTokenAsync();
        const token = tokenData.data;
        console.log('Obtained Expo push token:', token);
        if (socket.current) socket.current.emit('register', { userId, expoPushToken: token });
      } catch (err) {
        console.error('Error getting push token', err);
      }
    };

    registerForPush();
  }, []);

  // Track app foreground/background state and notify server
  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, []);

  const handleAppStateChange = (nextAppState) => {
    appStateRef.current = nextAppState;
    setAppState(nextAppState);
    const isBackground = nextAppState === 'background';
    console.log('App state changed to:', nextAppState, '- isBackground:', isBackground);
    if (socket.current) {
      socket.current.emit('appState', { isBackground });
    }
  };

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e) => {
      const toValue = e.endCoordinates ? e.endCoordinates.height : 250;
      setKeyboardSpace(toValue);
      Animated.timing(keyboardHeight, {
        toValue,
        duration: e.duration || 250,
        useNativeDriver: false,
      }).start();

      // Scroll to latest messages when keyboard appears
      setTimeout(() => {
        try { flatListRef.current?.scrollToOffset({ offset: 0, animated: true }); } catch (err) {}
      }, 120);
    };

    const onHide = (e) => {
      setKeyboardSpace(0);
      Animated.timing(keyboardHeight, {
        toValue: 0,
        duration: e.duration || 200,
        useNativeDriver: false,
      }).start();
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardHeight]);

  const handleTyping = (newText) => {
    setText(newText);
    
    if (socket.current && status.startsWith('Chatting')) {
      socket.current.emit('typing');

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

      typingTimeoutRef.current = setTimeout(() => {
        socket.current.emit('stop typing');
      }, 2000);
    }
  };

  const sendMessage = () => {
    if (text.trim() && socket.current) {
      socket.current.emit('stop typing');
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
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
      const messageData = { id: messageId, text, replyTo, userId: userIdRef.current }; // Send ID to server
      socket.current.emit('chat message', messageData);
      setMessages((prevMessages) => [
        {
          id: messageId,
          text,
          userId: userId, // Use state userId
          replyTo,
        },
        ...prevMessages,
      ]); 
      setReplyTo(null);
      setText('');
      // ensure FlatList shows the latest message
      setTimeout(() => {
        try { flatListRef.current?.scrollToOffset({ offset: 0, animated: true }); } catch (err) {}
      }, 80);
      }
    }
  };

  const skipConnection = () => {
    if (socket.current) {
      socket.current.emit('skip');
      setMessages([]);
      setIsPartnerTyping(false);
      setIsPartnerPaused(false);
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
    if (item.type === 'system') {
      return (
        <View style={styles.systemMessageContainer}>
          <View style={[
            styles.systemMessageBubble,
            item.text === 'Stranger left' && { backgroundColor: '#ff4444' }
          ]}>
            <Text style={styles.systemMessageText}>{item.text}</Text>
          </View>
        </View>
      );
    }

    const isMe = item.userId === userId; // Determine ownership at render time
    const isReacting = activeReactionId === item.id;

    return (
      <SwipeableMessage
        onReply={() =>
          setReplyTo({
            id: item.id,
            text: item.text,
            userId: item.userId,
          })
        }
        isReacting={isReacting}
        isMe={isMe}
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
                  {item.replyTo.userId === userId ? 'You' : 'Stranger'}
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
    <View style={{ flex: 1, backgroundColor: '#38527d' }}>
    <View style={{ flex: 1 }}>
    <View style={styles.topContainer}>
      <Text style={styles.status}>{status}</Text>
      <FlatList
        style={styles.messageList}
        data={messages}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        inverted // To show latest messages at the bottom
        removeClippedSubviews={false} // Important: allows the picker to overflow visible bounds
        ref={flatListRef}
        contentContainerStyle={{ paddingTop: inputBarHeight + insets.bottom + keyboardSpace + 10, paddingHorizontal: 10 }}
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
    </View>

      {isPartnerPaused && (
        <View style={styles.pausedContainer}>
          <Text style={styles.pausedText}>Stranger is offline</Text>
          <Text style={styles.pausedSubText}>Room closes in {Math.floor(pauseCountdown / 60)}:{(pauseCountdown % 60).toString().padStart(2, '0')}</Text>
          <View style={styles.pausedButtons}>
             <TouchableOpacity style={styles.waitButton} onPress={() => setIsPartnerPaused(false)}>
                <Text style={styles.buttonText}>Wait</Text>
             </TouchableOpacity>
             <TouchableOpacity style={styles.skipButtonPaused} onPress={skipConnection}>
                <Text style={styles.buttonText}>Skip</Text>
             </TouchableOpacity>
          </View>
        </View>
      )}

      {(status.startsWith('Chatting') || status === 'Stranger is offline') && (
        <Animated.View onLayout={(e) => setInputBarHeight(e.nativeEvent.layout.height)} style={{ flexDirection: 'column', position: 'absolute', left: 0, right: 0, bottom: insets.bottom, zIndex: isMenuOpen ? 1 : 9999, elevation: isMenuOpen ? 0 : 9999, transform: [{ translateY: Animated.multiply(keyboardHeight, -1) }] }}>
          {replyTo && (
            <View style={styles.replyBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.replyingTo}>
                  Replying to {replyTo.userId === userId ? 'You' : 'Stranger'}
                </Text>
                <Text numberOfLines={1}>{replyTo.text}</Text>
              </View>

              <TouchableOpacity onPress={() => setReplyTo(null)}>
                <Text style={styles.closeReply}>✕</Text>
              </TouchableOpacity>
            </View>
          )}
          {isPartnerTyping && (
            <Text style={styles.typingIndicator}>Stranger is typing...</Text>
          )}
          <View style={styles.inputContainer}>
            <TouchableOpacity onPress={skipConnection}>
              <LinearGradient
                colors={['#c279fe', '#b762fe']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.skipButton}
              >
                <Text style={styles.buttonText}>Skip</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={text}
              onChangeText={handleTyping}
              placeholder="Type a message..."
              onSubmitEditing={sendMessage}
              returnKeyType="send"
              blurOnSubmit={false}
            />
            <TouchableOpacity onPress={sendMessage}>
              <LinearGradient
                colors={['#69bbff', '#4eafff']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.sendButton}
              >
                <Text style={styles.buttonText}>{editingMessage ? 'Update' : 'Send'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </View>

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

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  topContainer: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingTop: 40, // Add padding for status bar
  },
  status: {
    fontSize: 18,
    textAlign: 'center',
    paddingVertical: 10,
    color: '#fff',
    fontWeight: 'bold',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
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
    backgroundColor: '#fff',
    borderBottomRightRadius: 4,
    borderWidth: 3,
    borderColor: '#4eafff',
  },
  theirBubble: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 4,
    borderWidth: 5,
    borderColor: '#ccc',
  },
  myText: {
    color: '#000',
    fontSize: 16,
  },
  theirText: {
    color: '#000',
    fontSize: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: 'transparent',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
    fontSize: 16,
    borderWidth: 2,
    borderColor: '#4eafff',
  },
  skipButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    marginRight: 10,
  },
  sendButton: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 18,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
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
    color: '#fff',
    fontWeight: 'bold',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  menuOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 99998,
  },
  sideMenu: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 250,
    backgroundColor: '#fff',
    zIndex: 99999,
    paddingTop: 60,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 99999,
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
  systemMessageContainer: {
    alignItems: 'center',
    marginVertical: 10,
    width: '100%',
  },
  systemMessageBubble: {
    backgroundColor: '#4ef892',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 4,
  },
  systemMessageText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  typingIndicator: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 20,
    marginBottom: 5,
    fontStyle: 'italic',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  pausedContainer: {
    position: 'absolute',
    top: '40%',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.9)',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    zIndex: 10000,
    width: '80%',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  pausedText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  pausedSubText: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 20,
  },
  pausedButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  waitButton: {
    backgroundColor: '#4eafff',
    paddingVertical: 10,
    paddingHorizontal: 30,
    borderRadius: 20,
  },
  skipButtonPaused: {
    backgroundColor: '#ff4444',
    paddingVertical: 10,
    paddingHorizontal: 30,
    borderRadius: 20,
  },
});
