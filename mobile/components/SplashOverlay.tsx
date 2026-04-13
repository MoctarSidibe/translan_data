import React, { useEffect, useRef } from 'react';
import { View, Image, StyleSheet, Animated, Easing } from 'react-native';

interface Props {
  isReady: boolean;
  onDone: () => void;
}

export default function SplashOverlay({ isReady, onDone }: Props) {
  const screenOp = useRef(new Animated.Value(1)).current;
  const logoScale = useRef(new Animated.Value(0.82)).current;
  const logoOp = useRef(new Animated.Value(0)).current;

  // Gentle logo fade + scale-in on mount
  useEffect(() => {
    Animated.parallel([
      Animated.timing(logoOp, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        damping: 14,
        stiffness: 100,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Fade out when auth is resolved
  useEffect(() => {
    if (!isReady) return;
    Animated.sequence([
      Animated.delay(300),
      Animated.timing(screenOp, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
        easing: Easing.in(Easing.ease),
      }),
    ]).start(({ finished }) => {
      if (finished) onDone();
    });
  }, [isReady]);

  return (
    <Animated.View
      style={[styles.root, { opacity: screenOp }]}
      pointerEvents={isReady ? 'none' : 'box-only'}
    >
      <Animated.Image
        source={require('../assets/logo.jpg')}
        style={[styles.logo, { opacity: logoOp, transform: [{ scale: logoScale }] }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 220,
    height: 220,
  },
});
