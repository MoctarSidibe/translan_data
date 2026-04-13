/**
 * File Browser Screen
 * Local tab  — pick files from device via expo-document-picker → AI extract → view / send
 * Web tab    — paste a URL → AI scrape → view / send
 *
 * Viewer modal: shows full extracted text, highlight mode lets user tap paragraphs
 * to select them, then Analyze with AI or Send to Module.
 */
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow, FontSizes } from '../constants/theme';
import { filesAPI, knowledgeAPI, modulesAPI, queryAPI } from '../services/api';

type TabType = 'local' | 'web';

const FILE_ICONS: Record<string, string> = {
  '.pdf':  'document-text',
  '.docx': 'document',
  '.doc':  'document',
  '.txt':  'document-outline',
  '.md':   'document-outline',
  '.csv':  'grid-outline',
};

interface ExtractResult {
  knowledge_id: number;
  title: string;
  summary: string;
  tags: string[];
  char_count: number;
}

interface KnowledgeDetail {
  id: number;
  title: string;
  content: string;
  summary: string;
  tags: string[];
}

const HIGHLIGHT_COLORS = [
  { label: 'Yellow', value: '#FFE066' },
  { label: 'Green',  value: '#A8F0A0' },
  { label: 'Blue',   value: '#A0CFFF' },
  { label: 'Pink',   value: '#FFB3D1' },
];

export default function FilesScreen() {
  const router = useRouter();
  const [tab, setTab]       = useState<TabType>('local');
  const [url, setUrl]       = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ExtractResult[]>([]);
  const [fileSearch, setFileSearch] = useState('');

  // ── Viewer ─────────────────────────────────────────────────────────────────
  const [viewerKnow, setViewerKnow]   = useState<KnowledgeDetail | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [highlightMode, setHighlightMode] = useState(false);
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0].value);
  const [selectedParas, setSelectedParas] = useState<Set<number>>(new Set());
  const [aiAnalysis, setAiAnalysis]   = useState('');
  const [aiAnalyzing, setAiAnalyzing] = useState(false);

  // ── Send to Module ─────────────────────────────────────────────────────────
  const [showSendModal, setShowSendModal] = useState(false);
  const [modules, setModules]   = useState<{ id: number; name: string }[]>([]);
  const [sendingModule, setSendingModule] = useState(false);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const getParagraphs = () =>
    (viewerKnow?.content ?? '')
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

  const getSelectedText = () => {
    const paras = getParagraphs();
    return [...selectedParas]
      .sort((a, b) => a - b)
      .map((i) => paras[i])
      .join('\n\n');
  };

  const togglePara = (i: number) => {
    setSelectedParas((prev) => {
      const s = new Set(prev);
      s.has(i) ? s.delete(i) : s.add(i);
      return s;
    });
  };

  // ── Local file pick ────────────────────────────────────────────────────────

  const pickAndExtract = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain', 'text/markdown', 'text/csv',
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (picked.canceled || !picked.assets?.length) return;
      const asset = picked.assets[0];

      setLoading(true);
      const form = new FormData();
      form.append('file', {
        uri: asset.uri, name: asset.name,
        type: asset.mimeType ?? 'application/octet-stream',
      } as any);

      const { data } = await filesAPI.upload(form);
      setResults((prev) => [data, ...prev]);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not extract file.');
    }
    setLoading(false);
  };

  // ── Web URL scrape ─────────────────────────────────────────────────────────

  const scrapeUrl = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const { data } = await filesAPI.scrapeUrl(url.trim());
      setResults((prev) => [data, ...prev]);
      setUrl('');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not scrape that URL.');
    }
    setLoading(false);
  };

  // ── Open viewer ────────────────────────────────────────────────────────────

  const openViewer = async (r: ExtractResult) => {
    setViewerLoading(true);
    setHighlightMode(false);
    setSelectedParas(new Set());
    setAiAnalysis('');
    setViewerKnow({
      id: r.knowledge_id, title: r.title,
      content: r.summary, summary: r.summary, tags: r.tags,
    });
    try {
      const { data } = await knowledgeAPI.get(r.knowledge_id);
      setViewerKnow({
        id: data.id ?? r.knowledge_id,
        title: data.title ?? r.title,
        content: data.content ?? data.summary ?? r.summary,
        summary: data.summary ?? r.summary,
        tags: data.tags ?? r.tags,
      });
    } catch {
      // already set the summary fallback above
    }
    setViewerLoading(false);
  };

  // ── AI analyze highlighted ─────────────────────────────────────────────────

  const runAiAnalysis = async () => {
    const text = getSelectedText();
    if (!text) {
      Alert.alert('Select text first', 'Enable highlight mode and tap paragraphs to select them.');
      return;
    }
    setAiAnalyzing(true);
    setAiAnalysis('');
    try {
      const { data } = await queryAPI.run(text, 3);
      setAiAnalysis(data.answer ?? data.response ?? JSON.stringify(data));
    } catch (e: any) {
      setAiAnalysis('Error: ' + (e?.response?.data?.detail ?? 'Could not analyze text.'));
    }
    setAiAnalyzing(false);
  };

  // ── Open send modal ────────────────────────────────────────────────────────

  const openSendModal = async () => {
    const text = getSelectedText();
    if (!text) {
      Alert.alert('Select text first', 'Enable highlight mode and tap paragraphs to select them.');
      return;
    }
    setShowSendModal(true);
    setModules([]);
    try {
      const { data } = await modulesAPI.list();
      const list = Array.isArray(data) ? data : (data.modules ?? []);
      setModules(list.map((m: any) => ({ id: m.id, name: m.name })));
    } catch {}
  };

  const sendToModule = async (moduleId: number) => {
    const text = getSelectedText();
    if (!text) return;
    setSendingModule(true);
    try {
      const { data: mod } = await modulesAPI.get(moduleId);
      // column_definitions is the correct API key (not mod.columns)
      const firstCol =
        mod.column_definitions?.find((c: any) => !c.name.startsWith('__'))?.name ??
        Object.keys(mod.rows?.[0]?.data ?? {}).find((k) => !k.startsWith('__')) ??
        'Content';
      const rowData: Record<string, string> = { [firstCol]: text };
      // addRow expects { data, linked_row_ids, linked_knowledge_ids }
      await modulesAPI.addRow(moduleId, { data: rowData, linked_row_ids: [], linked_knowledge_ids: [] });
      Alert.alert('Sent!', 'Highlighted text added to module as a new row.');
      setShowSendModal(false);
      setSelectedParas(new Set());
      setHighlightMode(false);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not send to module.');
    }
    setSendingModule(false);
  };

  const extIcon = (name: string) => {
    const ext = '.' + (name.split('.').pop() ?? '');
    return (FILE_ICONS[ext] ?? 'document-outline') as any;
  };

  const paragraphs = getParagraphs();
  const selCount   = selectedParas.size;

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>File Browser</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        {(['local', 'web'] as TabType[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            onPress={() => setTab(t)}
          >
            <Ionicons
              name={t === 'local' ? 'phone-portrait-outline' : 'globe-outline'}
              size={16}
              color={tab === t ? Colors.white : Colors.primary}
            />
            <Text style={[styles.tabBtnText, tab === t && styles.tabBtnTextActive]}>
              {t === 'local' ? 'Local Device' : 'Web URL'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>

        {/* ── LOCAL TAB ── */}
        {tab === 'local' && (
          <>
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.infoText}>
                Pick a PDF, DOCX, TXT or CSV. AI will extract and summarize it, then you can
                view the full text, highlight passages, and send them to a module.
              </Text>
            </View>
            <Text style={styles.supported}>Supported: PDF · DOCX · TXT · MD · CSV</Text>
            <TouchableOpacity style={styles.pickBtn} onPress={pickAndExtract} disabled={loading}>
              {loading ? (
                <>
                  <ActivityIndicator color={Colors.white} />
                  <Text style={styles.pickBtnText}>Extracting…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={22} color={Colors.white} />
                  <Text style={styles.pickBtnText}>Choose File</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* ── WEB TAB ── */}
        {tab === 'web' && (
          <>
            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.infoText}>
                Paste any web URL — article, blog, docs. AI extracts the main content.
                Then view it, highlight passages, and run AI analysis or send to a module.
              </Text>
            </View>
            <View style={styles.urlRow}>
              <TextInput
                style={styles.urlInput}
                placeholder="https://example.com/article"
                value={url}
                onChangeText={setUrl}
                autoCapitalize="none"
                keyboardType="url"
                placeholderTextColor={Colors.textMuted}
                returnKeyType="go"
                onSubmitEditing={scrapeUrl}
              />
              <TouchableOpacity
                style={[styles.goBtn, !url.trim() && styles.goBtnDisabled]}
                onPress={scrapeUrl}
                disabled={!url.trim() || loading}
              >
                {loading
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Ionicons name="arrow-forward" size={20} color={Colors.white} />
                }
              </TouchableOpacity>
            </View>
            <Text style={styles.supported}>Works with: Articles · Blogs · Docs · Wikipedia</Text>
          </>
        )}

        {/* ── RESULTS ── */}
        {results.length > 0 && (
          <View style={styles.resultsSection}>
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsLabel}>RECENTLY EXTRACTED</Text>
              <View style={styles.fileSearchBar}>
                <Ionicons name="search-outline" size={13} color={Colors.textMuted} />
                <TextInput
                  style={styles.fileSearchInput}
                  placeholder="Filter…"
                  value={fileSearch}
                  onChangeText={setFileSearch}
                  placeholderTextColor={Colors.textMuted}
                />
                {fileSearch ? (
                  <TouchableOpacity onPress={() => setFileSearch('')} hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}>
                    <Ionicons name="close-circle" size={13} color={Colors.textMuted} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
            {results
              .filter(r => !fileSearch.trim() ||
                r.title.toLowerCase().includes(fileSearch.toLowerCase()) ||
                r.summary?.toLowerCase().includes(fileSearch.toLowerCase()))
              .map((r, i) => (
              <View key={i} style={styles.resultCard}>
                <View style={styles.resultIcon}>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.resultSummary} numberOfLines={2}>{r.summary}</Text>
                  <View style={styles.resultMeta}>
                    {r.tags?.slice(0, 3).map((t: string) => (
                      <Text key={t} style={styles.resultTag}>{t}</Text>
                    ))}
                    <Text style={styles.resultChars}>{r.char_count?.toLocaleString()} chars</Text>
                  </View>
                  {/* View button */}
                  <TouchableOpacity
                    style={styles.viewBtn}
                    onPress={() => openViewer(r)}
                  >
                    <Ionicons name="eye-outline" size={14} color={Colors.primary} />
                    <Text style={styles.viewBtnText}>View Content</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ══════════════════════════════════════════════════════════════════════
          TEXT VIEWER MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={!!viewerKnow}
        animationType="slide"
        onRequestClose={() => setViewerKnow(null)}
      >
        <SafeAreaView style={styles.viewerSafe}>
          {/* Viewer header */}
          <View style={styles.viewerHeader}>
            <TouchableOpacity onPress={() => setViewerKnow(null)} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color={Colors.white} />
            </TouchableOpacity>
            <Text style={styles.viewerTitle} numberOfLines={1}>
              {viewerKnow?.title ?? 'Content'}
            </Text>
            {/* Highlight mode toggle */}
            <TouchableOpacity
              style={[styles.hlToggle, highlightMode && styles.hlToggleActive]}
              onPress={() => {
                setHighlightMode((p) => !p);
                setSelectedParas(new Set());
                setAiAnalysis('');
              }}
            >
              <Ionicons
                name="color-wand-outline"
                size={18}
                color={highlightMode ? Colors.white : Colors.primary}
              />
            </TouchableOpacity>
          </View>

          {/* Color picker row (only in highlight mode) */}
          {highlightMode && (
            <View style={styles.colorRow}>
              <Text style={styles.colorLabel}>Highlighter:</Text>
              {HIGHLIGHT_COLORS.map((c) => (
                <TouchableOpacity
                  key={c.value}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c.value },
                    highlightColor === c.value && styles.colorDotActive,
                  ]}
                  onPress={() => setHighlightColor(c.value)}
                />
              ))}
              {selCount > 0 && (
                <Text style={styles.selCount}>{selCount} selected</Text>
              )}
            </View>
          )}

          {/* Paragraph content */}
          {viewerLoading ? (
            <View style={styles.viewerLoader}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.viewerLoaderText}>Loading content…</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.viewerBody}>
              {paragraphs.map((para, i) => {
                const isSelected = selectedParas.has(i);
                return (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={highlightMode ? 0.7 : 1}
                    disabled={!highlightMode}
                    onPress={() => togglePara(i)}
                    style={[
                      styles.paraBlock,
                      isSelected && { backgroundColor: highlightColor },
                    ]}
                  >
                    <Text style={styles.paraText}>{para}</Text>
                  </TouchableOpacity>
                );
              })}

              {/* AI analysis result */}
              {(aiAnalysis || aiAnalyzing) && (
                <View style={styles.aiResultBox}>
                  <View style={styles.aiResultHeader}>
                    <Ionicons name="sparkles" size={16} color="#7B1FA2" />
                    <Text style={styles.aiResultTitle}>AI Analysis</Text>
                  </View>
                  {aiAnalyzing
                    ? <ActivityIndicator color="#7B1FA2" style={{ marginTop: 8 }} />
                    : <Text style={styles.aiResultText}>{aiAnalysis}</Text>
                  }
                </View>
              )}
            </ScrollView>
          )}

          {/* Action bar (visible when paragraphs selected or highlight mode on) */}
          {highlightMode && (
            <View style={styles.actionBar}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSecondary, selCount === 0 && styles.actionBtnDisabled]}
                onPress={runAiAnalysis}
                disabled={selCount === 0 || aiAnalyzing}
              >
                {aiAnalyzing
                  ? <ActivityIndicator size="small" color="#7B1FA2" />
                  : <Ionicons name="sparkles-outline" size={16} color="#7B1FA2" />
                }
                <Text style={styles.actionBtnSecondaryText}>
                  {aiAnalyzing ? 'Analyzing…' : 'Analyze with AI'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnPrimary, selCount === 0 && styles.actionBtnDisabled]}
                onPress={openSendModal}
                disabled={selCount === 0}
              >
                <Ionicons name="git-network-outline" size={16} color={Colors.white} />
                <Text style={styles.actionBtnPrimaryText}>Send to Module</Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          SEND TO MODULE MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={showSendModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSendModal(false)}
      >
        <Pressable style={styles.sendOverlay} onPress={() => setShowSendModal(false)} />
        <View style={styles.sendSheet}>
          <View style={styles.sendHandle} />
          <Text style={styles.sendTitle}>Send to Module</Text>
          <Text style={styles.sendSub}>
            Selected text will be added as a new row in the module.
          </Text>

          {/* Selected text preview */}
          <View style={styles.sendPreview}>
            <Text style={styles.sendPreviewText} numberOfLines={3}>
              {getSelectedText()}
            </Text>
          </View>

          {modules.length === 0 ? (
            <View style={styles.sendLoader}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.sendLoaderText}>Loading modules…</Text>
            </View>
          ) : (
            <ScrollView style={styles.moduleList} showsVerticalScrollIndicator={false}>
              {modules.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.moduleRow}
                  onPress={() => sendToModule(m.id)}
                  disabled={sendingModule}
                >
                  <Ionicons name="grid-outline" size={18} color={Colors.primary} />
                  <Text style={styles.moduleRowName}>{m.name}</Text>
                  {sendingModule
                    ? <ActivityIndicator size="small" color={Colors.primary} />
                    : <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                  }
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity style={styles.sendCancelBtn} onPress={() => setShowSendModal(false)}>
            <Text style={styles.sendCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    backgroundColor: Colors.primaryDark, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '700' },

  // ── Tabs ──────────────────────────────────────────────────────────────────
  tabBar: {
    flexDirection: 'row', padding: 12, gap: 10,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.primary,
  },
  tabBtnActive: { backgroundColor: Colors.primary },
  tabBtnText: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.primary },
  tabBtnTextActive: { color: Colors.white },

  // ── Body ──────────────────────────────────────────────────────────────────
  body: { padding: 16, gap: 14 },
  infoBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: '#EEF2FF', borderRadius: Radius.md, padding: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  infoText: { flex: 1, fontSize: FontSizes.sm, color: Colors.textSecondary, lineHeight: 19 },
  supported: { fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
  pickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 16, ...Shadow.md,
  },
  pickBtnText: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '700' },
  urlRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  urlInput: {
    flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: FontSizes.base, color: Colors.textPrimary,
    backgroundColor: Colors.surface,
  },
  goBtn: {
    width: 48, height: 48, borderRadius: Radius.md,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  goBtnDisabled: { backgroundColor: Colors.border },

  // ── Results ───────────────────────────────────────────────────────────────
  resultsSection: { marginTop: 8, gap: 10 },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  resultsLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.5 },
  fileSearchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.surface, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.border,
  },
  fileSearchInput: { flex: 1, fontSize: 12, color: Colors.textPrimary },
  resultCard: {
    flexDirection: 'row', gap: 12, backgroundColor: Colors.surface,
    borderRadius: Radius.md, padding: 12, ...Shadow.sm,
  },
  resultIcon: { paddingTop: 2 },
  resultTitle: { fontSize: FontSizes.base, fontWeight: '700', color: Colors.textPrimary },
  resultSummary: { fontSize: FontSizes.sm, color: Colors.textSecondary, marginTop: 2, lineHeight: 18 },
  resultMeta: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' },
  resultTag: {
    fontSize: 11, color: Colors.primary, backgroundColor: Colors.background,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  resultChars: { fontSize: 11, color: Colors.textMuted },
  viewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 8, alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.primary,
  },
  viewBtnText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },

  // ── Viewer modal ──────────────────────────────────────────────────────────
  viewerSafe: { flex: 1, backgroundColor: Colors.background },
  viewerHeader: {
    backgroundColor: Colors.primaryDark, flexDirection: 'row',
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 8,
  },
  viewerTitle: { flex: 1, color: Colors.white, fontSize: FontSizes.md, fontWeight: '700' },
  hlToggle: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: Colors.primary, backgroundColor: 'transparent',
  },
  hlToggleActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  colorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  colorLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  colorDot: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: 'transparent',
  },
  colorDotActive: { borderColor: Colors.textPrimary },
  selCount: { marginLeft: 'auto', fontSize: 12, color: Colors.primary, fontWeight: '700' },
  viewerLoader: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  viewerLoaderText: { color: Colors.textMuted, fontSize: FontSizes.sm },
  viewerBody: { padding: 16, paddingBottom: 80, gap: 4 },
  paraBlock: {
    borderRadius: Radius.sm, padding: 8,
    marginBottom: 6,
  },
  paraText: { fontSize: FontSizes.base, color: Colors.textPrimary, lineHeight: 24 },

  // AI result box
  aiResultBox: {
    marginTop: 16, borderRadius: Radius.md, padding: 14,
    backgroundColor: '#F3E5F5', borderWidth: 1, borderColor: '#CE93D8',
  },
  aiResultHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  aiResultTitle: { fontSize: FontSizes.sm, fontWeight: '700', color: '#7B1FA2' },
  aiResultText: { fontSize: FontSizes.sm, color: '#4A148C', lineHeight: 20 },

  // Action bar
  actionBar: {
    flexDirection: 'row', gap: 10, padding: 12,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: Radius.md,
  },
  actionBtnPrimary: { backgroundColor: Colors.primary },
  actionBtnSecondary: {
    backgroundColor: '#F3E5F5', borderWidth: 1, borderColor: '#CE93D8',
  },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnPrimaryText: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.sm },
  actionBtnSecondaryText: { color: '#7B1FA2', fontWeight: '700', fontSize: FontSizes.sm },

  // ── Send to Module modal ──────────────────────────────────────────────────
  sendOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sendSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '70%',
  },
  sendHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 16,
  },
  sendTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.textPrimary, marginBottom: 4 },
  sendSub: { fontSize: FontSizes.sm, color: Colors.textSecondary, marginBottom: 12 },
  sendPreview: {
    backgroundColor: '#FFF9C4', borderRadius: Radius.sm, padding: 10, marginBottom: 14,
    borderWidth: 1, borderColor: '#F9A825',
  },
  sendPreviewText: { fontSize: FontSizes.sm, color: Colors.textPrimary, lineHeight: 19 },
  sendLoader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 20 },
  sendLoaderText: { color: Colors.textMuted, fontSize: FontSizes.sm },
  moduleList: { maxHeight: 280 },
  moduleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  moduleRowName: { flex: 1, fontSize: FontSizes.base, color: Colors.textPrimary, fontWeight: '600' },
  sendCancelBtn: {
    marginTop: 14, paddingVertical: 12, alignItems: 'center',
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
  },
  sendCancelText: { color: Colors.textSecondary, fontSize: FontSizes.sm, fontWeight: '600' },
});
