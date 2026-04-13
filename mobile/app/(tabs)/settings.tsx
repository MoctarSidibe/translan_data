/**
 * Settings Screen
 * • Language selection (EN, FR, AR, ZH, DE, JA, PT, ES)
 * • Profile (username, full name, email)
 * • Default browser
 * • Font size (+/-)
 * • References type
 * • Payment card info
 * • Disconnect profile
 * • Back to homepage
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Alert, Modal, TextInput, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Shadow, FontSizes } from '../../constants/theme';
import { useAuthStore } from '../../store/authStore';
import { authAPI } from '../../services/api';
import { useRouter } from 'expo-router';
import AppHeader from '../../components/AppHeader';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'ar', label: 'Arabic' },
  { code: 'zh', label: 'Chinese' },
  { code: 'de', label: 'German' },
  { code: 'ja', label: 'Japanese' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'es', label: 'Spanish' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { user, logout, updateUser } = useAuthStore();
  const [fontSize, setFontSize] = useState(user?.font_size ?? 14);
  const [language, setLanguage] = useState(user?.language ?? 'en');
  const [showLangModal, setShowLangModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [darkMode, setDarkMode] = useState(false);

  const saveFontSize = async (size: number) => {
    setFontSize(size);
    updateUser({ font_size: size });
    await authAPI.updateMe({ font_size: size });
  };

  const saveLanguage = async (code: string) => {
    setLanguage(code);
    setShowLangModal(false);
    updateUser({ language: code });
    await authAPI.updateMe({ language: code });
  };

  const saveProfile = async () => {
    setShowProfileModal(false);
    updateUser({ full_name: fullName });
    await authAPI.updateMe({ full_name: fullName });
  };

  const confirmLogout = () => {
    Alert.alert('Disconnect', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  const currentLang = LANGUAGES.find((l) => l.code === language)?.label ?? 'English';

  return (
    <SafeAreaView style={styles.safe}>
      <AppHeader
        leftActions={[
          { icon: 'search-outline', onPress: () => router.navigate('/(tabs)'), color: Colors.textMuted },
          { icon: 'settings', color: Colors.primary, active: true },          // Settings — active
          { icon: 'library-outline', onPress: () => router.navigate('/(tabs)/knowledge'), color: Colors.textMuted },
          { icon: 'book-outline', onPress: () => router.navigate('/(tabs)/learn'), color: Colors.textMuted },
        ]}
      />

      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* ── Profile ── */}
        <Text style={styles.sectionLabel}>PROFILE</Text>
        <View style={styles.card}>
          <View style={styles.profileAvatar}>
            <Text style={styles.avatarText}>
              {(user?.username ?? 'U')[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{user?.full_name || user?.username}</Text>
            <Text style={styles.profileEmail}>{user?.email}</Text>
            {user?.is_premium && (
              <View style={styles.premiumBadge}>
                <Ionicons name="star" size={11} color={Colors.gold} />
                <Text style={styles.premiumText}>Premium</Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={() => setShowProfileModal(true)}>
            <Ionicons name="pencil-outline" size={20} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        {/* ── Language ── */}
        <Text style={styles.sectionLabel}>LANGUAGE</Text>
        <TouchableOpacity style={styles.row} onPress={() => setShowLangModal(true)}>
          <Ionicons name="language-outline" size={20} color={Colors.primary} />
          <Text style={styles.rowLabel}>Language</Text>
          <Text style={styles.rowValue}>{currentLang}</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>

        {/* ── Appearance ── */}
        <Text style={styles.sectionLabel}>APPEARANCE</Text>

        <View style={styles.row}>
          <Ionicons name="text-outline" size={20} color={Colors.primary} />
          <Text style={styles.rowLabel}>Font Size</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => saveFontSize(Math.max(10, fontSize - 1))}
            >
              <Text style={styles.stepBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepValue}>{fontSize}</Text>
            <TouchableOpacity
              style={styles.stepBtn}
              onPress={() => saveFontSize(Math.min(24, fontSize + 1))}
            >
              <Text style={styles.stepBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.row}>
          <Ionicons name="moon-outline" size={20} color={Colors.primary} />
          <Text style={styles.rowLabel}>Dark Mode</Text>
          <Switch
            value={darkMode}
            onValueChange={setDarkMode}
            trackColor={{ true: Colors.primary }}
          />
        </View>

        {/* ── AI & Data ── */}
        <Text style={styles.sectionLabel}>AI & DATA</Text>

        <View style={styles.row}>
          <Ionicons name="hardware-chip-outline" size={20} color={Colors.primary} />
          <Text style={styles.rowLabel}>AI Model</Text>
          <Text style={styles.rowValue}>Groq Llama 3.3</Text>
        </View>

        <TouchableOpacity style={styles.row}>
          <Ionicons name="cloud-upload-outline" size={20} color={Colors.primary} />
          <Text style={styles.rowLabel}>Sync to Server</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.row}>
          <Ionicons name="download-outline" size={20} color={Colors.primary} />
          <Text style={styles.rowLabel}>Export All Data</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>

        {/* ── Marketplace Access ── */}
        <Text style={styles.sectionLabel}>MARKETPLACE</Text>

        {user?.is_premium ? (
          /* Unlocked state */
          <View style={styles.accessCard}>
            <View style={[styles.accessIconWrap, { backgroundColor: '#E8F5E9' }]}>
              <Ionicons name="earth" size={22} color={Colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accessTitle}>Marketplace Access</Text>
              <Text style={styles.accessSub}>Browse, buy, rate and publish knowledge</Text>
            </View>
            <View style={styles.unlockedBadge}>
              <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
              <Text style={styles.unlockedText}>Unlocked</Text>
            </View>
          </View>
        ) : (
          /* Locked state — upsell card */
          <View style={styles.accessCard}>
            <View style={[styles.accessIconWrap, { backgroundColor: '#EEF4FF' }]}>
              <Ionicons name="earth-outline" size={22} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accessTitle}>Marketplace Access</Text>
              <Text style={styles.accessSub}>One-time $20 · Lifetime access</Text>
              <View style={styles.accessFeatures}>
                {['Browse & buy knowledge', 'Rate & comment', 'Publish and earn (keep 80%)'].map(f => (
                  <View key={f} style={styles.accessFeatureRow}>
                    <Ionicons name="checkmark" size={11} color={Colors.primary} />
                    <Text style={styles.accessFeatureTxt}>{f}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {!user?.is_premium && (
          <TouchableOpacity
            style={styles.unlockBtn}
            onPress={() => router.push('/payment?amount=20.00&description=Marketplace+Access&premium=1')}
          >
            <Ionicons name="lock-open-outline" size={18} color={Colors.white} />
            <Text style={styles.unlockBtnTxt}>Unlock Marketplace — $20</Text>
          </TouchableOpacity>
        )}

        {/* ── Payment ── */}
        <Text style={styles.sectionLabel}>PAYMENT</Text>

        <TouchableOpacity
          style={styles.row}
          onPress={() => router.push('/payment?amount=0.00&description=Add+Payment+Card')}
        >
          <Ionicons name="card-outline" size={20} color={Colors.primary} />
          <Text style={styles.rowLabel}>Payment Card</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>

        {/* ── About ── */}
        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.row}>
          <Ionicons name="information-circle-outline" size={20} color={Colors.primary} />
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.rowValue}>1.0.0</Text>
        </View>

        {/* ── Logout ── */}
        <TouchableOpacity style={[styles.row, styles.logoutRow]} onPress={confirmLogout}>
          <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          <Text style={[styles.rowLabel, { color: Colors.error }]}>Disconnect Profile</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Language Modal ── */}
      <Modal visible={showLangModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select Language</Text>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[styles.langItem, language === lang.code && styles.langItemActive]}
                onPress={() => saveLanguage(lang.code)}
              >
                <Text style={[styles.langText, language === lang.code && styles.langTextActive]}>
                  {lang.label}
                </Text>
                {language === lang.code && <Ionicons name="checkmark" size={18} color={Colors.primary} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowLangModal(false)}>
              <Text style={{ color: Colors.textSecondary, textAlign: 'center' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Profile Edit Modal ── */}
      <Modal visible={showProfileModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Full Name"
              value={fullName}
              onChangeText={setFullName}
              placeholderTextColor={Colors.textMuted}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn2} onPress={() => setShowProfileModal(false)}>
                <Text style={{ color: Colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={saveProfile}>
                <Text style={{ color: Colors.white, fontWeight: '700' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1,
    paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6,
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, marginHorizontal: 12,
    borderRadius: Radius.md, padding: 16, ...Shadow.sm,
  },
  profileAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.primaryDark, justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: Colors.white, fontSize: FontSizes.xl, fontWeight: '800' },
  profileName: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.textPrimary },
  profileEmail: { fontSize: FontSizes.sm, color: Colors.textSecondary, marginTop: 2 },
  premiumBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 4, backgroundColor: '#FFF8E1', paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: Radius.full, alignSelf: 'flex-start',
  },
  premiumText: { fontSize: 11, color: Colors.gold, fontWeight: '700' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, marginHorizontal: 12, marginBottom: 1,
    paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: Radius.sm,
  },
  rowLabel: { flex: 1, fontSize: FontSizes.base, color: Colors.textPrimary },
  rowValue: { fontSize: FontSizes.sm, color: Colors.textSecondary },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    justifyContent: 'center', alignItems: 'center',
  },
  stepBtnText: { fontSize: FontSizes.md, color: Colors.primary, fontWeight: '700' },
  stepValue: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.textPrimary, minWidth: 28, textAlign: 'center' },
  logoutRow: { marginTop: 20, marginBottom: 10 },

  // Marketplace access card
  accessCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: Colors.surface, marginHorizontal: 12, marginBottom: 1,
    borderRadius: Radius.md, padding: 14, ...Shadow.sm,
  },
  accessIconWrap: {
    width: 42, height: 42, borderRadius: 21,
    justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  accessTitle: { fontSize: FontSizes.base, fontWeight: '700', color: Colors.textPrimary },
  accessSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  accessFeatures: { marginTop: 6, gap: 3 },
  accessFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  accessFeatureTxt: { fontSize: 11, color: Colors.textSecondary },
  unlockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#E8F5E9', borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start',
  },
  unlockedText: { fontSize: 11, fontWeight: '700', color: Colors.success },
  unlockBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, marginHorizontal: 12, marginTop: 8,
    borderRadius: Radius.md, paddingVertical: 13, ...Shadow.sm,
  },
  unlockBtnTxt: { color: Colors.white, fontWeight: '800', fontSize: FontSizes.base },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 4 },
  modalTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  langItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  langItemActive: { },
  langText: { fontSize: FontSizes.base, color: Colors.textPrimary },
  langTextActive: { fontWeight: '700', color: Colors.primary },
  cancelBtn: { paddingVertical: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, marginTop: 10 },
  cancelBtn2: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  confirmBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center' },
  modalInput: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 10, fontSize: FontSizes.base, color: Colors.textPrimary },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
});
