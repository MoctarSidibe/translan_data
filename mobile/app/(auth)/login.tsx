import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, FontSizes, Shadow } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please enter email and password.');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (e: any) {
      Alert.alert('Login Failed', e?.response?.data?.detail ?? 'Invalid credentials.');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.container}>
          {/* Logo area */}
          <View style={styles.logoArea}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoLetter}>T</Text>
            </View>
            <Text style={styles.appName}>TRANSLAN</Text>
            <Text style={styles.appTag}>DATA</Text>
          </View>

          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your knowledge base</Text>

          <View style={styles.form}>
            <View style={styles.inputWrap}>
              <Ionicons name="mail-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor={Colors.textMuted}
              />
            </View>

            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPass}
                placeholderTextColor={Colors.textMuted}
              />
              <TouchableOpacity onPress={() => setShowPass(!showPass)} style={styles.eyeBtn}>
                <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading}>
              {loading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.loginBtnText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.signupRow}>
              <Text style={styles.signupText}>Don't have an account? </Text>
              <Link href="/(auth)/register" asChild>
                <TouchableOpacity>
                  <Text style={styles.signupLink}>Create one</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.primaryDark },
  container: { flexGrow: 1, padding: 28, justifyContent: 'center' },
  logoArea: { alignItems: 'center', marginBottom: 36 },
  logoCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
    ...Shadow.md,
  },
  logoLetter: { color: Colors.white, fontSize: 40, fontWeight: '900' },
  appName: { color: Colors.white, fontSize: 26, fontWeight: '900', letterSpacing: 3, marginTop: 14 },
  appTag: {
    color: Colors.white, fontSize: 13, fontWeight: '700', letterSpacing: 3,
    backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 3,
    borderRadius: Radius.sm, marginTop: 4,
  },
  title: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.white, textAlign: 'center' },
  subtitle: { fontSize: FontSizes.sm, color: Colors.accent, textAlign: 'center', marginBottom: 28 },
  form: { gap: 14 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: Radius.md, paddingHorizontal: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, height: 48, color: Colors.white, fontSize: FontSizes.base },
  eyeBtn: { padding: 4 },
  loginBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    height: 50, justifyContent: 'center', alignItems: 'center',
    marginTop: 8, ...Shadow.md,
  },
  loginBtnText: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '700' },
  signupRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 6 },
  signupText: { color: Colors.accent, fontSize: FontSizes.sm },
  signupLink: { color: Colors.white, fontSize: FontSizes.sm, fontWeight: '700' },
});
