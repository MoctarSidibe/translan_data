/**
 * Shared top navbar — logo absolutely centered, icons on both sides.
 * Logo always stays at exact center regardless of icon count imbalance.
 */
import React from 'react';
import { View, Image, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadow } from '../constants/theme';

export interface Action {
  icon: string;
  onPress?: () => void;
  color?: string;
  active?: boolean;   // highlights the button background (active tab indicator)
  badge?: boolean;    // small dot (notification / recording indicator)
}

interface Props {
  leftActions?: Action[];
  rightActions?: Action[];
  style?: ViewStyle;
}

export default function AppHeader({ leftActions = [], rightActions = [], style }: Props) {
  return (
    <View style={[styles.bar, style]}>
      {/* Left slot */}
      <View style={styles.side}>
        {leftActions.map((a, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.btn, a.active && styles.btnActive]}
            onPress={a.onPress}
            activeOpacity={a.onPress ? 0.7 : 1}
          >
            <Ionicons name={a.icon as any} size={25} color={a.color ?? Colors.primary} />
            {a.badge && <View style={styles.dot} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* Logo — absolutely centered, pointerEvents none so touches pass through */}
      <View style={styles.logoWrap} pointerEvents="none">
        <Image
          source={require('../assets/logo.jpg')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      {/* Right slot */}
      <View style={[styles.side, styles.sideRight]}>
        {rightActions.map((a, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.btn, a.active && styles.btnActive]}
            onPress={a.onPress}
            activeOpacity={a.onPress ? 0.7 : 1}
          >
            <Ionicons name={a.icon as any} size={25} color={a.color ?? Colors.primary} />
            {a.badge && <View style={styles.dot} />}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: Colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    ...Shadow.sm,
  },
  side: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    flex: 1,
    zIndex: 1,
  },
  sideRight: {
    justifyContent: 'flex-end',
  },
  btn: {
    width: 36,
    height: 42,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnActive: {
    backgroundColor: Colors.primary + '18',
  },
  logoWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 0,
  },
  logo: {
    width: 145,
    height: 48,
  },
  dot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.error,
    borderWidth: 1.5,
    borderColor: Colors.white,
  },
});
