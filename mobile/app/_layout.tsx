import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '../store/authStore';
import { Colors } from '../constants/theme';
import { syncAll } from '../services/syncService';
import SplashOverlay from '../components/SplashOverlay';

export default function RootLayout() {
  const { loadToken, user, isLoading } = useAuthStore();

  // Show splash until auth resolves AND a minimum display time has passed
  const [splashDone, setSplashDone]         = useState(false);
  const [minTimePassed, setMinTimePassed]   = useState(false);
  const [authResolved, setAuthResolved]     = useState(false);

  // Kick off auth check
  useEffect(() => {
    loadToken().then(() => setAuthResolved(true));
  }, []);

  // Minimum 1.8 s display so the animation completes fully
  useEffect(() => {
    const t = setTimeout(() => setMinTimePassed(true), 1800);
    return () => clearTimeout(t);
  }, []);

  // Trigger sync whenever user logs in
  useEffect(() => {
    if (user) syncAll().catch(() => {});
  }, [user?.id]);

  // The splash is "ready to fade" when BOTH conditions are met
  const splashCanFade = authResolved && minTimePassed;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" backgroundColor={Colors.primaryDark} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
      </Stack>

      {/* Splash overlay sits on top of everything, then fades out */}
      {!splashDone && (
        <SplashOverlay
          isReady={splashCanFade}
          onDone={() => setSplashDone(true)}
        />
      )}
    </GestureHandlerRootView>
  );
}
