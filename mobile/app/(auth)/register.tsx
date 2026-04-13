import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, FontSizes, Shadow } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';

export default function RegisterScreen() {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuthStore();

  const handleRegister = async () => {
    if (!email.trim() || !username.trim() || !password) {
      Alert.alert('Error', 'Please fill all required fields.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      await register({ email: email.trim().toLowerCase(), username: username.trim(), password, full_name: fullName.trim() });
    } catch (e: any) {
      Alert.alert('Registration Failed', e?.response?.data?.detail ?? 'Please try again.');
    }
    setLoading(false);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.logoArea}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoLetter}>T</Text>
            </View>
            <Text style={styles.appName}>TRANSLAN DATA</Text>
          </View>

          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Start building your personal knowledge base</Text>

          <View style={styles.form}>
            {[
              { label: 'Full Name', value: fullName, setter: setFullName, icon: 'person-outline', optional: true },
              { label: 'Username *', value: username, setter: setUsername, icon: 'at-outline' },
              { label: 'Email *', value: email, setter: setEmail, icon: 'mail-outline', keyboard: 'email-address' as const },
              { label: 'Password *', value: password, setter: setPassword, icon: 'lock-closed-outline', secure: true },
            ].map((field) => (
              <View key={field.label} style={styles.inputWrap}>
                <Ionicons name={field.icon as any} size={18} color={Colors.textMuted} style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.input}
                  placeholder={field.label}
                  value={field.value}
                  onChangeText={field.setter}
                  secureTextEntry={field.secure}
                  keyboardType={field.keyboard}
                  autoCapitalize="none"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
            ))}

            <TouchableOpacity style={styles.registerBtn} onPress={handleRegister} disabled={loading}>
              {loading ? <ActivityIndicator color={Colors.white} /> : (
                <Text style={styles.registerBtnText}>Create Account</Text>
              )}
            </TouchableOpacity>

            <View style={styles.loginRow}>
              <Text style={styles.loginText}>Already have an account? </Text>
              <Link href="/(auth)/login" asChild>
                <TouchableOpacity>
                  <Text style={styles.loginLink}>Sign in</Text>
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
  logoArea: { alignItems: 'center', marginBottom: 28 },
  logoCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  logoLetter: { color: Colors.white, fontSize: 32, fontWeight: '900' },
  appName: { color: Colors.white, fontSize: 18, fontWeight: '900', letterSpacing: 2, marginTop: 10 },
  title: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.white, textAlign: 'center' },
  subtitle: { fontSize: FontSizes.sm, color: Colors.accent, textAlign: 'center', marginBottom: 24 },
  form: { gap: 12 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: Radius.md, paddingHorizontal: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  input: { flex: 1, height: 48, color: Colors.white, fontSize: FontSizes.base },
  registerBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    height: 50, justifyContent: 'center', alignItems: 'center',
    marginTop: 8, ...Shadow.md,
  },
  registerBtnText: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '700' },
  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 6 },
  loginText: { color: Colors.accent, fontSize: FontSizes.sm },
  loginLink: { color: Colors.white, fontSize: FontSizes.sm, fontWeight: '700' },
});
