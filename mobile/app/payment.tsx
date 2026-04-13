/**
 * Payment Screen — Visa / Mastercard simulation
 *
 * Shows a realistic card entry form:
 *  • Card number with auto-spacing + Visa/MC logo detection
 *  • Cardholder name, expiry (MM/YY), CVV
 *  • Selected plan or knowledge item shown at top
 *  • Processing animation → success / failure screen
 *
 * Usage: router.push('/payment?amount=9.99&description=Premium+Monthly&premium=1')
 *        router.push('/payment?amount=4.99&description=Knowledge+Title&knowledgeId=3')
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Animated, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors, Radius, Shadow, FontSizes } from '../constants/theme';
import api from '../services/api';

type CardType = 'visa' | 'mastercard' | 'amex' | 'unknown';

function detectCard(num: string): CardType {
  const n = num.replace(/\s/g, '');
  if (n.startsWith('4')) return 'visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  return 'unknown';
}

function formatCardNumber(raw: string, type: CardType): string {
  const digits = raw.replace(/\D/g, '').slice(0, type === 'amex' ? 15 : 16);
  if (type === 'amex') {
    return digits.replace(/(\d{4})(\d{0,6})(\d{0,5})/, (_, a, b, c) =>
      [a, b, c].filter(Boolean).join(' ')
    );
  }
  return digits.replace(/(\d{4})/g, '$1 ').trim();
}

function CardLogo({ type }: { type: CardType }) {
  if (type === 'visa') return (
    <View style={[styles.cardLogo, { backgroundColor: '#1A1F71' }]}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 13, fontStyle: 'italic' }}>VISA</Text>
    </View>
  );
  if (type === 'mastercard') return (
    <View style={styles.cardLogo}>
      <View style={[styles.mcCircle, { backgroundColor: '#EB001B', marginRight: -8 }]} />
      <View style={[styles.mcCircle, { backgroundColor: '#F79E1B' }]} />
    </View>
  );
  if (type === 'amex') return (
    <View style={[styles.cardLogo, { backgroundColor: '#007BC1' }]}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 9 }}>AMEX</Text>
    </View>
  );
  return null;
}

type PaymentStep = 'form' | 'processing' | 'success' | 'failed';

export default function PaymentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    amount: string;
    description: string;
    premium: string;
    knowledgeId: string;
  }>();

  const amount = parseFloat(params.amount ?? '9.99');
  const description = params.description ?? 'Translan Data';
  const isPremium = params.premium === '1';
  const isMarketplaceAccess = isPremium && Math.abs(amount - 20) < 0.01;
  const knowledgeId = params.knowledgeId ? parseInt(params.knowledgeId) : undefined;

  const [cardNumber, setCardNumber] = useState('');
  const [cardHolder, setCardHolder] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [step, setStep] = useState<PaymentStep>('form');
  const [result, setResult] = useState<any>(null);
  const cardType = detectCard(cardNumber);

  const handleCardNumber = (raw: string) => {
    const type = detectCard(raw.replace(/\s/g, ''));
    setCardNumber(formatCardNumber(raw, type));
  };

  const handleExpiry = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) {
      setExpiry(digits.slice(0, 2) + '/' + digits.slice(2));
    } else {
      setExpiry(digits);
    }
  };

  const handlePay = useCallback(async () => {
    if (!cardNumber.replace(/\s/g, '') || !cardHolder || !expiry || !cvv) {
      Alert.alert('Missing fields', 'Please fill in all card details.');
      return;
    }
    setStep('processing');
    try {
      const { data } = await api.post('/api/payment/charge', {
        card_number: cardNumber,
        card_holder: cardHolder,
        expiry,
        cvv,
        amount,
        description,
        knowledge_id: knowledgeId ?? null,
        upgrade_premium: isPremium,
      });
      setResult(data);
      setStep(data.success ? 'success' : 'failed');
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Payment error. Please try again.';
      setResult({ message: msg });
      setStep('failed');
    }
  }, [cardNumber, cardHolder, expiry, cvv, amount, description, knowledgeId, isPremium]);

  // ── Processing ──────────────────────────────────────────────────────────────
  if (step === 'processing') {
    return (
      <SafeAreaView style={[styles.safe, styles.centeredPage]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.processingText}>Processing payment…</Text>
        <Text style={styles.processingSubtext}>Please wait, do not close the app.</Text>
      </SafeAreaView>
    );
  }

  // ── Success ─────────────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <SafeAreaView style={[styles.safe, styles.centeredPage]}>
        <View style={styles.successIcon}>
          <Ionicons name="checkmark-circle" size={72} color={Colors.success} />
        </View>
        <Text style={styles.successTitle}>Payment Successful!</Text>
        <Text style={styles.successAmount}>${amount.toFixed(2)}</Text>
        <View style={styles.txnBox}>
          <Text style={styles.txnLabel}>Transaction ID</Text>
          <Text style={styles.txnId}>{result?.transaction_id}</Text>
          <Text style={styles.txnLabel}>{result?.card_type} ···· {result?.last4}</Text>
        </View>
        {isMarketplaceAccess && (
          <View style={[styles.premiumUnlocked, { backgroundColor: '#E8F5E9' }]}>
            <Ionicons name="earth" size={16} color={Colors.success} />
            <Text style={[styles.premiumUnlockedText, { color: Colors.success }]}>
              Marketplace Access unlocked! Browse, buy &amp; sell.
            </Text>
          </View>
        )}
        {isPremium && !isMarketplaceAccess && (
          <View style={styles.premiumUnlocked}>
            <Ionicons name="star" size={16} color={Colors.gold} />
            <Text style={styles.premiumUnlockedText}>Premium account activated!</Text>
          </View>
        )}
        <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()}>
          <Text style={styles.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Failed ──────────────────────────────────────────────────────────────────
  if (step === 'failed') {
    return (
      <SafeAreaView style={[styles.safe, styles.centeredPage]}>
        <Ionicons name="close-circle" size={72} color={Colors.error} />
        <Text style={styles.failedTitle}>Payment Failed</Text>
        <Text style={styles.failedMsg}>{result?.message}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => setStep('form')}>
          <Text style={styles.retryBtnText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: Colors.textMuted, fontSize: FontSizes.sm }}>Cancel</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Card Form ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Secure Payment</Text>
        <Ionicons name="lock-closed" size={16} color={Colors.accent} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.body}>
        {/* Order summary */}
        <View style={styles.orderBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderDesc}>{description}</Text>
            {isMarketplaceAccess && (
              <Text style={styles.orderSub}>One-time · Lifetime marketplace access</Text>
            )}
            {isPremium && !isMarketplaceAccess && (
              <Text style={styles.orderSub}>Premium subscription</Text>
            )}
            {knowledgeId && (
              <Text style={styles.orderSub}>Knowledge purchase · Platform fee 20%</Text>
            )}
          </View>
          <Text style={styles.orderAmount}>
            {amount === 0 ? 'FREE' : `$${amount.toFixed(2)}`}
          </Text>
        </View>

        {/* Card visual */}
        <View style={styles.cardVisual}>
          <View style={styles.cardChip}>
            <Ionicons name="hardware-chip-outline" size={22} color="#d4a843" />
          </View>
          <Text style={styles.cardNumberDisplay}>
            {cardNumber || '•••• •••• •••• ••••'}
          </Text>
          <View style={styles.cardBottom}>
            <View>
              <Text style={styles.cardFieldLabel}>CARD HOLDER</Text>
              <Text style={styles.cardFieldValue}>
                {cardHolder.toUpperCase() || 'YOUR NAME'}
              </Text>
            </View>
            <View>
              <Text style={styles.cardFieldLabel}>EXPIRES</Text>
              <Text style={styles.cardFieldValue}>{expiry || 'MM/YY'}</Text>
            </View>
            <CardLogo type={cardType} />
          </View>
        </View>

        {/* Form fields */}
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>Card Number</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={cardNumber}
              onChangeText={handleCardNumber}
              placeholder="1234 5678 9012 3456"
              keyboardType="numeric"
              maxLength={19}
              placeholderTextColor={Colors.textMuted}
            />
            <CardLogo type={cardType} />
          </View>

          <Text style={styles.fieldLabel}>Cardholder Name</Text>
          <TextInput
            style={styles.input}
            value={cardHolder}
            onChangeText={setCardHolder}
            placeholder="Name as on card"
            autoCapitalize="characters"
            placeholderTextColor={Colors.textMuted}
          />

          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Expiry Date</Text>
              <TextInput
                style={styles.input}
                value={expiry}
                onChangeText={handleExpiry}
                placeholder="MM/YY"
                keyboardType="numeric"
                maxLength={5}
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>CVV</Text>
              <TextInput
                style={styles.input}
                value={cvv}
                onChangeText={(t) => setCvv(t.replace(/\D/g, '').slice(0, 4))}
                placeholder="•••"
                keyboardType="numeric"
                secureTextEntry
                maxLength={4}
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          </View>
        </View>

        {/* Security notice */}
        <View style={styles.secureNotice}>
          <Ionicons name="shield-checkmark-outline" size={14} color={Colors.success} />
          <Text style={styles.secureText}>256-bit SSL encrypted · Simulated payment</Text>
        </View>

        {/* Pay button */}
        <TouchableOpacity style={styles.payBtn} onPress={handlePay}>
          <Ionicons name="card-outline" size={20} color={Colors.white} />
          <Text style={styles.payBtnText}>Pay ${amount.toFixed(2)}</Text>
        </TouchableOpacity>

        <Text style={styles.testTip}>
          Test cards: 4111 1111 1111 1111 (Visa approved) · any card ending 0000 (declined)
        </Text>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    backgroundColor: Colors.primaryDark, flexDirection: 'row',
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 10,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, color: Colors.white, fontSize: FontSizes.md, fontWeight: '700' },
  body: { padding: 16, gap: 16, paddingBottom: 40 },
  orderBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: 16, ...Shadow.sm, borderLeftWidth: 4, borderLeftColor: Colors.primary,
  },
  orderDesc: { fontSize: FontSizes.base, fontWeight: '700', color: Colors.textPrimary },
  orderSub: { fontSize: FontSizes.sm, color: Colors.textSecondary, marginTop: 2 },
  orderAmount: { fontSize: FontSizes.xl, fontWeight: '900', color: Colors.primary },
  cardVisual: {
    backgroundColor: Colors.primaryDark, borderRadius: 16,
    padding: 20, aspectRatio: 1.586,
    justifyContent: 'space-between', ...Shadow.md,
  },
  cardChip: { width: 36 },
  cardNumberDisplay: { color: Colors.white, fontSize: 18, fontWeight: '600', letterSpacing: 2 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  cardFieldLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 9, letterSpacing: 1 },
  cardFieldValue: { color: Colors.white, fontSize: 13, fontWeight: '600', marginTop: 2 },
  cardLogo: { flexDirection: 'row', alignItems: 'center', borderRadius: 4, padding: 4 },
  mcCircle: { width: 22, height: 22, borderRadius: 11 },
  form: { gap: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, marginBottom: 4 },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: FontSizes.base, color: Colors.textPrimary,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row2: { flexDirection: 'row', gap: 12 },
  secureNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#F0FFF4', borderRadius: Radius.md,
    padding: 10, borderWidth: 1, borderColor: '#C6F6D5',
  },
  secureText: { fontSize: 12, color: Colors.success, fontWeight: '600' },
  payBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 16, ...Shadow.md,
  },
  payBtnText: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '800' },
  testTip: { fontSize: 11, color: Colors.textMuted, textAlign: 'center' },
  centeredPage: { justifyContent: 'center', alignItems: 'center', gap: 12, padding: 32 },
  processingText: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.textPrimary },
  processingSubtext: { fontSize: FontSizes.sm, color: Colors.textSecondary },
  successIcon: { marginBottom: 8 },
  successTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.textPrimary },
  successAmount: { fontSize: 36, fontWeight: '900', color: Colors.primary },
  txnBox: {
    backgroundColor: Colors.surface, borderRadius: Radius.md, padding: 16,
    alignItems: 'center', gap: 4, width: '100%', ...Shadow.sm,
  },
  txnLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  txnId: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.textPrimary },
  premiumUnlocked: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
    backgroundColor: '#FFF8E1', borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  premiumUnlockedText: { color: Colors.gold, fontWeight: '700', fontSize: FontSizes.sm },
  doneBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: 48, paddingVertical: 14, ...Shadow.md, width: '100%', alignItems: 'center',
  },
  doneBtnText: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '800' },
  failedTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.error },
  failedMsg: { fontSize: FontSizes.sm, color: Colors.textSecondary, textAlign: 'center' },
  retryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: 48, paddingVertical: 14, width: '100%', alignItems: 'center',
  },
  retryBtnText: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '800' },
});
