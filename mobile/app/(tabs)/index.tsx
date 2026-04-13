/**
 * Home — Query Mode (RAG Chat)
 *
 * Layout:
 *   • Top navbar: [Learn | Knowledge | Settings] Logo [History | Search●]
 *   • Chat messages area (scrollable)
 *   • Enhanced bottom input dock: voice, text, send
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Animated, Share, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as SecureStore from 'expo-secure-store';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Shadow, FontSizes } from '../../constants/theme';
import { queryAPI, knowledgeAPI, modulesAPI } from '../../services/api';
import AppHeader from '../../components/AppHeader';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';

const AI_DAILY_LIMIT = 10;
const TODAY_KEY  = () => `ai_date_${new Date().toDateString()}`;
const COUNT_KEY  = 'ai_query_count';

interface Source { id: number; title: string; excerpt: string; similarity: number }
interface Message {
  id: string;
  type: 'user' | 'ai';
  text: string;
  sources?: Source[];
  queryId?: number;
}
interface HistoryItem { id: number; query_text: string; answer_text: string; created_at: string }

export default function QueryScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // AI daily usage counter (free users: 10/day; marketplace members: unlimited)
  const [aiUsedToday, setAiUsedToday] = useState(0);
  const isUnlimited = !!user?.is_premium;

  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(TODAY_KEY());
        if (stored === 'ok') {
          const c = parseInt(await SecureStore.getItemAsync(COUNT_KEY) ?? '0');
          setAiUsedToday(c);
        } else {
          // New day — reset
          await SecureStore.setItemAsync(COUNT_KEY, '0');
          setAiUsedToday(0);
        }
      } catch {}
    })();
  }, []);

  const incrementUsage = async () => {
    const next = aiUsedToday + 1;
    setAiUsedToday(next);
    try {
      await SecureStore.setItemAsync(TODAY_KEY(), 'ok');
      await SecureStore.setItemAsync(COUNT_KEY, String(next));
    } catch {}
  };

  // Transfer AI answer → Learning Module
  const [transferMsg, setTransferMsg] = useState<Message | null>(null);
  const [transferModules, setTransferModules] = useState<{ id: number; name: string }[]>([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(-320)).current;
  const scrollRef = useRef<ScrollView>(null);

  const { state: voiceState, toggle: toggleVoice } = useVoiceInput((text) => {
    setInput((prev) => (prev ? prev + ' ' + text : text));
  });

  const openHistory = useCallback(async () => {
    setHistoryOpen(true);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, speed: 14 }).start();
    setHistoryLoading(true);
    try {
      const { data } = await queryAPI.history(20);
      setHistoryItems(data);
    } catch { }
    setHistoryLoading(false);
  }, []);

  const closeHistory = useCallback(() => {
    Animated.spring(slideAnim, { toValue: -320, useNativeDriver: true, speed: 14 }).start(() =>
      setHistoryOpen(false)
    );
  }, []);

  const runQuery = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    // Enforce daily limit for free users
    if (!isUnlimited && aiUsedToday >= AI_DAILY_LIMIT) {
      Alert.alert(
        'Daily limit reached',
        `Free users get ${AI_DAILY_LIMIT} AI queries per day. Unlock the Marketplace for unlimited queries.`,
        [
          { text: 'Unlock — $20', onPress: () => router.push('/payment?amount=20.00&description=Marketplace+Access&premium=1') },
          { text: 'OK', style: 'cancel' },
        ]
      );
      return;
    }

    setInput('');
    const userMsg: Message = { id: Date.now().toString(), type: 'user', text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    await incrementUsage();
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const { data } = await queryAPI.run(text);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        text: data.answer,
        sources: data.sources,
        queryId: data.query_id,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        text: '⚠️ Could not reach the server. Make sure the backend is running.',
      }]);
    }
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [input, loading]);

  const copyAnswer = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Answer copied to clipboard.');
  };

  const exportAnswer = async (text: string) => {
    await Share.share({ message: text });
  };

  const saveToKnowledge = async (msg: Message) => {
    try {
      await knowledgeAPI.create({
        title: `AI Answer — ${new Date().toLocaleDateString()}`,
        content: msg.text,
        source_type: 'ai_output',
        tags: ['ai-answer'],
      });
      Alert.alert('Saved', 'Answer saved to your Knowledge Box.');
    } catch {
      Alert.alert('Error', 'Could not save. Please try again.');
    }
  };

  const openTransfer = async (msg: Message) => {
    setTransferMsg(msg);
    try {
      const { data } = await modulesAPI.list();
      setTransferModules(data);
    } catch { setTransferModules([]); }
  };

  const transferToModule = async (moduleId: number) => {
    if (!transferMsg) return;
    setTransferLoading(true);
    try {
      const { data: mod } = await modulesAPI.get(moduleId);
      const firstCol = mod.column_definitions[0]?.name ?? 'Content';
      const rowData: Record<string, string> = {};
      mod.column_definitions.forEach((c: { name: string }) => { rowData[c.name] = ''; });
      rowData[firstCol] = transferMsg.text.slice(0, 500);
      // If there's a second column, put a truncated version / title there
      if (mod.column_definitions[1]) {
        rowData[mod.column_definitions[1].name] = `AI answer — ${new Date().toLocaleDateString()}`;
      }
      await modulesAPI.addRow(moduleId, { data: rowData, linked_row_ids: [], linked_knowledge_ids: [] });
      setTransferMsg(null);
      Alert.alert('Transferred!', `Answer added to "${mod.name}". Open Learn to see it.`, [
        { text: 'Go to Learn', onPress: () => router.navigate('/(tabs)/learn') },
        { text: 'OK' },
      ]);
    } catch {
      Alert.alert('Error', 'Could not transfer to module.');
    }
    setTransferLoading(false);
  };

  const transferToNewModule = async () => {
    if (!transferMsg) return;
    setTransferLoading(true);
    try {
      const { data } = await modulesAPI.aiCreate(
        `Create a module to store this AI answer: "${transferMsg.text.slice(0, 200)}"`
      );
      setTransferMsg(null);
      Alert.alert('Module Created!', `"${data.name}" created with the answer. Open Learn to see it.`, [
        { text: 'Go to Learn', onPress: () => router.navigate('/(tabs)/learn') },
        { text: 'OK' },
      ]);
    } catch {
      Alert.alert('Error', 'Could not create module.');
    }
    setTransferLoading(false);
  };

  const loadHistoryItem = (item: HistoryItem) => {
    closeHistory();
    setMessages([
      { id: 'h-u', type: 'user', text: item.query_text },
      { id: 'h-a', type: 'ai', text: item.answer_text, sources: [] },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>

      {/* ── Top Navbar ── */}
      <AppHeader
        leftActions={[
          // Navigation: Settings, Knowledge, Learn
          { icon: 'settings-outline', onPress: () => router.navigate('/(tabs)/settings'), color: Colors.textMuted },
          { icon: 'library-outline', onPress: () => router.navigate('/(tabs)/knowledge'), color: Colors.textMuted },
          { icon: 'book-outline', onPress: () => router.navigate('/(tabs)/learn'), color: Colors.textMuted },
        ]}
        rightActions={[
          // History drawer
          { icon: 'time-outline', onPress: openHistory, color: Colors.textMuted },
          // Query (active — we are here)
          { icon: 'search', color: Colors.primary, active: true },
        ]}
      />

      {/* ── History Sidebar ── */}
      {historyOpen && (
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={closeHistory} />
      )}
      <Animated.View style={[styles.sidebar, { transform: [{ translateX: slideAnim }] }]}>
        <SafeAreaView edges={['top']}>
          <View style={styles.sidebarHeader}>
            <Text style={styles.sidebarTitle}>Recent Queries</Text>
            <TouchableOpacity onPress={closeHistory}>
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          {historyLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={Colors.primary} />
          ) : (
            <ScrollView style={{ flex: 1 }}>
              {historyItems.length === 0 && (
                <Text style={styles.sidebarEmpty}>No recent queries yet.</Text>
              )}
              {historyItems.map((item) => (
                <TouchableOpacity key={item.id} style={styles.historyItem} onPress={() => loadHistoryItem(item)}>
                  <Ionicons name="chatbubble-outline" size={16} color={Colors.primary} />
                  <Text style={styles.historyText} numberOfLines={2}>{item.query_text}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </Animated.View>

      {/* ── Messages ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.messages}
          contentContainerStyle={{ padding: 16, paddingBottom: 8 }}
        >
          {messages.length === 0 && (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="planet-outline" size={38} color={Colors.white} />
              </View>
              <Text style={styles.emptyTitle}>Ask your knowledge base</Text>
              <Text style={styles.emptySubtitle}>
                Type a question below — AI searches your personal library and answers with sources.
              </Text>
              <View style={styles.emptyTips}>
                {[
                  '"What did I learn about React last week?"',
                  '"Summarize my notes on machine learning"',
                  '"Find information about climate change"',
                ].map((tip, i) => (
                  <TouchableOpacity key={i} style={styles.exampleChip} onPress={() => setInput(tip.replace(/"/g, ''))}>
                    <Ionicons name="arrow-forward-circle-outline" size={14} color={Colors.primary} />
                    <Text style={styles.exampleText}>{tip}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {messages.map((msg) => (
            <View key={msg.id} style={msg.type === 'user' ? styles.userBubble : styles.aiBubbleWrap}>
              {msg.type === 'user' ? (
                <View style={styles.userBubbleInner}>
                  <Text style={styles.userText}>{msg.text}</Text>
                </View>
              ) : (
                <View style={styles.aiBubble}>
                  <View style={styles.aiAvatar}>
                    <Text style={styles.aiAvatarText}>T</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.aiText}>{msg.text}</Text>

                    {/* Source Citations */}
                    {msg.sources && msg.sources.length > 0 && (
                      <View style={styles.citations}>
                        <Text style={styles.citationsLabel}>Sources</Text>
                        {msg.sources.map((s) => (
                          <View key={s.id} style={styles.citationItem}>
                            <Ionicons name="document-text-outline" size={12} color={Colors.primary} />
                            <Text style={styles.citationTitle} numberOfLines={1}>{s.title}</Text>
                            <View style={styles.simBadge}>
                              <Text style={styles.simText}>{Math.round(s.similarity * 100)}%</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Action buttons */}
                    <View style={styles.actionRow}>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => copyAnswer(msg.text)}>
                        <Ionicons name="copy-outline" size={13} color={Colors.primary} />
                        <Text style={styles.actionBtnText}>Copy</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtn} onPress={() => exportAnswer(msg.text)}>
                        <Ionicons name="share-outline" size={13} color={Colors.primary} />
                        <Text style={styles.actionBtnText}>Share</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, styles.saveBtn]} onPress={() => saveToKnowledge(msg)}>
                        <Ionicons name="bookmark-outline" size={13} color={Colors.success} />
                        <Text style={[styles.actionBtnText, { color: Colors.success }]}>Save</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.actionBtn, styles.transferBtn]} onPress={() => openTransfer(msg)}>
                        <Ionicons name="git-network-outline" size={13} color="#7B1FA2" />
                        <Text style={[styles.actionBtnText, { color: '#7B1FA2' }]}>Transfer</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              )}
            </View>
          ))}

          {loading && (
            <View style={styles.aiBubble}>
              <View style={styles.aiAvatar}>
                <Text style={styles.aiAvatarText}>T</Text>
              </View>
              <View style={styles.typingRow}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.typingText}>Thinking…</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* ═══ Enhanced Bottom Input Dock ═══ */}
        <View style={styles.inputDock}>
          {/* AI usage bar — only for free users */}
          {!isUnlimited && (
            <View style={styles.usageBar}>
              <View style={styles.usageTrack}>
                <View style={[
                  styles.usageFill,
                  { width: `${Math.min((aiUsedToday / AI_DAILY_LIMIT) * 100, 100)}%` as any },
                  aiUsedToday >= AI_DAILY_LIMIT && { backgroundColor: Colors.error },
                ]} />
              </View>
              <Text style={[styles.usageLabel, aiUsedToday >= AI_DAILY_LIMIT && { color: Colors.error }]}>
                {aiUsedToday >= AI_DAILY_LIMIT
                  ? 'Daily limit reached'
                  : `${AI_DAILY_LIMIT - aiUsedToday} AI queries left today`
                }
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/payment?amount=20.00&description=Marketplace+Access&premium=1')}
                hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
              >
                <Text style={styles.usageUnlock}>Unlock ∞</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Top row: context chips (optional) */}
          <View style={styles.inputCard}>
            {/* Left: Attach → opens File Browser */}
            <TouchableOpacity style={styles.dockIcon} activeOpacity={0.7} onPress={() => router.push('/files')}>
              <Ionicons name="attach-outline" size={20} color={Colors.textMuted} />
            </TouchableOpacity>

            {/* Text input */}
            <TextInput
              style={styles.dockInput}
              value={input}
              onChangeText={setInput}
              placeholder="Powered by AI · ask anything…"
              placeholderTextColor={Colors.textMuted}
              multiline
              returnKeyType="send"
              onSubmitEditing={runQuery}
            />

            {/* Clear */}
            {input.length > 0 && (
              <TouchableOpacity style={styles.dockIcon} onPress={() => setInput('')}>
                <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            )}

            {/* Mic */}
            <TouchableOpacity
              style={[styles.dockIcon, voiceState === 'recording' && styles.micActive]}
              onPress={toggleVoice}
              disabled={voiceState === 'transcribing'}
            >
              {voiceState === 'transcribing' ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Ionicons
                  name={voiceState === 'recording' ? 'stop-circle' : 'mic-outline'}
                  size={20}
                  color={voiceState === 'recording' ? Colors.error : Colors.primary}
                />
              )}
            </TouchableOpacity>

            {/* Send */}
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnOff]}
              onPress={runQuery}
              disabled={!input.trim() || loading}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Ionicons name="arrow-up" size={20} color={Colors.white} />
              }
            </TouchableOpacity>
          </View>

        </View>
      </KeyboardAvoidingView>

      {/* ── Transfer to Module modal ── */}
      {transferMsg !== null && (
        <View style={styles.transferOverlay}>
          <View style={styles.transferSheet}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={styles.transferIcon}>
                <Ionicons name="git-network-outline" size={18} color={Colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.transferTitle}>Transfer to Module</Text>
                <Text style={styles.transferSub}>Add this answer to a Learning module</Text>
              </View>
              <TouchableOpacity onPress={() => setTransferMsg(null)}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Preview snippet */}
            <View style={styles.transferPreview}>
              <Text style={styles.transferPreviewTxt} numberOfLines={3}>{transferMsg.text}</Text>
            </View>

            {transferLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <ActivityIndicator size="large" color="#7B1FA2" />
                <Text style={[styles.transferSub, { marginTop: 8 }]}>Transferring…</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 260 }}>
                {/* Create new module option */}
                <TouchableOpacity style={styles.transferModuleRow} onPress={transferToNewModule}>
                  <View style={[styles.transferModDot, { backgroundColor: '#7B1FA2' }]}>
                    <Ionicons name="add" size={14} color={Colors.white} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.transferModName}>Create New Module with AI</Text>
                    <Text style={styles.transferModSub}>AI will build a module structure from this answer</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={Colors.textMuted} />
                </TouchableOpacity>

                {transferModules.length > 0 && (
                  <Text style={styles.transferSectionLabel}>Add to existing module</Text>
                )}
                {transferModules.map((m, mi) => {
                  const colors = ['#3B52CC', '#00897B', '#E91E63', '#F57C00', '#8D6E63'];
                  const col = colors[mi % colors.length];
                  return (
                    <TouchableOpacity key={m.id} style={styles.transferModuleRow} onPress={() => transferToModule(m.id)}>
                      <View style={[styles.transferModDot, { backgroundColor: col }]} />
                      <Text style={[styles.transferModName, { flex: 1 }]} numberOfLines={1}>{m.name}</Text>
                      <Ionicons name="chevron-forward" size={15} color={Colors.textMuted} />
                    </TouchableOpacity>
                  );
                })}
                {transferModules.length === 0 && (
                  <Text style={styles.transferSub}>No modules yet — create one in the Learn tab first.</Text>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    zIndex: 10,
  },
  sidebar: {
    position: 'absolute',
    top: 0, bottom: 0, left: 0,
    width: 300,
    backgroundColor: Colors.surface,
    zIndex: 20,
    ...Shadow.md,
  },
  sidebarHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sidebarTitle: { fontSize: FontSizes.md, fontWeight: '700', color: Colors.textPrimary },
  sidebarEmpty: { padding: 24, color: Colors.textMuted, textAlign: 'center' },
  historyItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  historyText: { flex: 1, fontSize: FontSizes.sm, color: Colors.textPrimary, lineHeight: 18 },

  messages: { flex: 1 },

  emptyState: { alignItems: 'center', marginTop: 60, paddingHorizontal: 24 },
  emptyIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
    marginBottom: 18,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35, shadowRadius: 20, elevation: 10,
  },
  emptyTitle: {
    fontSize: FontSizes.xl, fontWeight: '800', color: Colors.textPrimary,
    marginBottom: 8, textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: FontSizes.sm, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 20, marginBottom: 20,
  },
  emptyTips: { gap: 8, width: '100%' },
  exampleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  exampleText: { flex: 1, fontSize: FontSizes.sm, color: Colors.primary, fontStyle: 'italic' },

  userBubble: { alignItems: 'flex-end', marginBottom: 12 },
  userBubbleInner: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg, borderBottomRightRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10, maxWidth: '80%',
  },
  userText: { color: Colors.white, fontSize: FontSizes.base, lineHeight: 22 },

  aiBubbleWrap: { marginBottom: 16 },
  aiBubble: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: Colors.surface, borderRadius: Radius.lg, borderTopLeftRadius: 4,
    padding: 12, ...Shadow.sm,
  },
  aiAvatar: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.primaryDark, justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  aiAvatarText: { color: Colors.white, fontWeight: '800', fontSize: 14 },
  aiText: { fontSize: FontSizes.base, color: Colors.textPrimary, lineHeight: 22 },

  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  typingText: { color: Colors.textMuted, fontSize: FontSizes.sm },

  citations: {
    marginTop: 10, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 8, gap: 5,
  },
  citationsLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '700', marginBottom: 2 },
  citationItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  citationTitle: { flex: 1, fontSize: 12, color: Colors.primary },
  simBadge: {
    backgroundColor: Colors.background, borderRadius: 8,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  simText: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },

  actionRow: { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  saveBtn: { borderColor: Colors.success + '60' },
  transferBtn: { borderColor: '#7B1FA260' },
  actionBtnText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },

  // ── Transfer modal ──
  transferOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    zIndex: 30,
  },
  transferSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    padding: 20, paddingBottom: 32,
    ...Shadow.md,
  },
  transferIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#7B1FA2',
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  transferTitle: { fontSize: FontSizes.md, fontWeight: '800', color: Colors.textPrimary },
  transferSub: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  transferPreview: {
    backgroundColor: Colors.background, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    padding: 10, marginBottom: 12,
  },
  transferPreviewTxt: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  transferSectionLabel: {
    fontSize: 10, fontWeight: '700', color: Colors.textMuted,
    letterSpacing: 0.6, marginTop: 12, marginBottom: 6,
    textTransform: 'uppercase',
  },
  transferModuleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  transferModDot: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  transferModName: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.textPrimary },
  transferModSub: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },

  // ═══ Enhanced Input Dock ═══
  usageBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2,
  },
  usageTrack: {
    flex: 1, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, overflow: 'hidden',
  },
  usageFill: {
    height: '100%', borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  usageLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },
  usageUnlock: {
    fontSize: 10, color: Colors.primary, fontWeight: '800',
    textDecorationLine: 'underline',
  },
  inputDock: {
    backgroundColor: Colors.white,
    paddingTop: 6,
    paddingHorizontal: 12,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 10,
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#F0F3FF',
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  dockIcon: {
    width: 30, height: 30,
    justifyContent: 'center', alignItems: 'center',
  },
  micActive: { backgroundColor: '#FFF0F0', borderRadius: 15 },
  dockInput: {
    flex: 1,
    minHeight: 28, maxHeight: 90,
    fontSize: 13,
    color: Colors.textPrimary,
    paddingTop: 4, paddingBottom: 4,
    lineHeight: 18,
  },
  sendBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.primary,
    justifyContent: 'center', alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  sendBtnOff: {
    backgroundColor: Colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
});
