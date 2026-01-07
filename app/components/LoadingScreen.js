import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Image, Animated, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

export default function LoadingScreen({ isLoaded, onComplete }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [isMinTimeElapsed, setIsMinTimeElapsed] = useState(false);

  useEffect(() => {
    // Fade In
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // Wait for 3 seconds minimum
    const timer = setTimeout(() => {
      setIsMinTimeElapsed(true);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Once min time passed AND app is loaded, Fade Out
    if (isMinTimeElapsed && isLoaded) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start(() => {
        if (onComplete) onComplete();
      });
    }
  }, [isMinTimeElapsed, isLoaded]);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Image
        source={require('../assets/splash-logo.png')}
        style={{ width: width * 0.5, height: width * 0.5 }}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
});