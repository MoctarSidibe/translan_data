import { Stack, Redirect } from 'expo-router';
import { useAuthStore } from '../../store/authStore';

export default function AuthLayout() {
  const { user, isLoading } = useAuthStore();

  // While loading, show the Stack but the SplashOverlay in root layout covers it
  if (isLoading) return <Stack screenOptions={{ headerShown: false }} />;

  // Already logged in — bounce straight to the app
  if (user) return <Redirect href="/(tabs)" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
