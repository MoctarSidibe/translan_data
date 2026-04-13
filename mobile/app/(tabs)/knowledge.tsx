/**
 * Knowledge Box — Private (my library) + Public (marketplace)
 * Private: list, search, category filter, tag filter, options (rename/publish/delete)
 * Public:  marketplace with star ratings, comment, download/buy
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Modal, Alert, ActivityIndicator, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Shadow, FontSizes } from '../../constants/theme';
import { knowledgeAPI, marketplaceAPI, modulesAPI } from '../../services/api';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import AppHeader from '../../components/AppHeader';

const CATEGORIES = [
  'All', 'General', 'Science', 'History', 'Technology', 'Personal',
  'Health', 'Business', 'Language', 'Art', 'Mathematics', 'Philosophy',
  'Travel', 'Food', 'Sports', 'Finance', 'Psychology', 'Environment',
  'Music', 'Literature',
];

const CATEGORY_ICONS: Record<string, string> = {
  All: 'apps-outline',
  General: 'bookmark-outline',
  Science: 'flask-outline',
  History: 'time-outline',
  Technology: 'hardware-chip-outline',
  Personal: 'person-outline',
  Health: 'heart-outline',
  Business: 'briefcase-outline',
  Language: 'language-outline',
  Art: 'color-palette-outline',
  Mathematics: 'calculator-outline',
  Philosophy: 'bulb-outline',
  Travel: 'airplane-outline',
  Food: 'restaurant-outline',
  Sports: 'fitness-outline',
  Finance: 'cash-outline',
  Psychology: 'happy-outline',
  Environment: 'leaf-outline',
  Music: 'musical-notes-outline',
  Literature: 'library-outline',
};

interface KnowledgeItem {
  id: number; title: string; summary: string; category: string;
  tags: string[]; is_public: boolean; price: number; rating: number;
  rating_count: number; download_count: number; updated_at: string;
}
interface PublicItem extends KnowledgeItem { author: string }

function StarRow({ rating, size = 13 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Ionicons key={s} name={rating >= s ? 'star' : 'star-outline'} size={size} color={Colors.gold} />
      ))}
    </View>
  );
}

export default function KnowledgeScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<'private' | 'public'>('private');
  const [privateItems, setPrivateItems] = useState<KnowledgeItem[]>([]);
  const [publicItems, setPublicItems] = useState<PublicItem[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<KnowledgeItem | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishPrice, setPublishPrice] = useState('0');
  const [showDetail, setShowDetail] = useState(false);

  // Rename
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  // Load into Module
  const [loadingIntoModule, setLoadingIntoModule] = useState(false);

  // Like + Comment (public)
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set());
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentTarget, setCommentTarget] = useState<PublicItem | null>(null);

  useEffect(() => { loadData(); }, [tab, search, category]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'private') {
        const params: any = {};
        if (search) params.search = search;
        if (category !== 'All') params.category = category;
        const { data } = await knowledgeAPI.list(params);
        setPrivateItems(data);
      } else {
        const params: any = { sort: 'rating' };
        if (search) params.search = search;
        if (category !== 'All') params.category = category;
        const { data } = await marketplaceAPI.browse(params);
        setPublicItems(data);
      }
    } catch { }
    setLoading(false);
  };

  const openOptions = (item: KnowledgeItem) => {
    setSelectedItem(item);
    setShowOptions(true);
  };

  const deleteItem = async () => {
    if (!selectedItem) return;
    setShowOptions(false);
    Alert.alert('Delete', `Delete "${selectedItem.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await knowledgeAPI.delete(selectedItem.id);
          loadData();
        },
      },
    ]);
  };

  const publishItem = async () => {
    setShowOptions(false);
    setShowPublishModal(true);
  };

  const confirmPublish = async () => {
    if (!selectedItem) return;
    const price = parseFloat(publishPrice) || 0;
    try {
      await knowledgeAPI.publish(selectedItem.id, price);
      setShowPublishModal(false);
      Alert.alert('Published!', `"${selectedItem.title}" is now available in the marketplace.`);
      loadData();
    } catch {
      Alert.alert('Error', 'Could not publish.');
    }
  };

  const rateItem = async (item: PublicItem, stars: number) => {
    try {
      await marketplaceAPI.rate(item.id, stars);
      loadData();
    } catch { }
  };

  // ── Rename ──────────────────────────────────────────────────────────────────

  const openRename = () => {
    setRenameTitle(selectedItem?.title ?? '');
    setShowOptions(false);
    setShowRenameModal(true);
  };

  const confirmRename = async () => {
    if (!selectedItem || !renameTitle.trim()) return;
    setRenameLoading(true);
    try {
      await knowledgeAPI.update(selectedItem.id, { title: renameTitle.trim() });
      setShowRenameModal(false);
      loadData();
    } catch {
      Alert.alert('Error', 'Could not rename.');
    }
    setRenameLoading(false);
  };

  // ── Load into Module ─────────────────────────────────────────────────────────

  const parseMarkdownTable = (content: string) => {
    const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
    const sepIdx = lines.findIndex(l => /^\|[-| ]+\|$/.test(l));
    if (sepIdx < 1) return { columns: ['Content'], rows: [{ Content: content.slice(0, 500) }] };
    const cols = lines[sepIdx - 1].split('|').map(c => c.trim()).filter(Boolean);
    const dataRows = lines.slice(sepIdx + 1)
      .filter(l => l.startsWith('|'))
      .map(l => {
        const vals = l.split('|').map(v => v.trim()).filter(Boolean);
        const row: Record<string, string> = {};
        cols.forEach((c, i) => { row[c] = vals[i] ?? ''; });
        return row;
      });
    return { columns: cols, rows: dataRows };
  };

  const loadIntoModule = async () => {
    if (!selectedItem) return;
    setShowOptions(false);
    setLoadingIntoModule(true);
    try {
      const { data: detail } = await knowledgeAPI.get(selectedItem.id);
      const content = detail.content ?? detail.summary ?? selectedItem.summary ?? '';
      const { columns, rows } = parseMarkdownTable(content);
      const colDefs = columns.map(name => ({ name, type: 'text' as const }));
      const { data: newMod } = await modulesAPI.create({
        name: selectedItem.title,
        description: selectedItem.summary ?? '',
        column_definitions: colDefs.length ? colDefs : [{ name: 'Content', type: 'text' }],
      });
      for (const row of rows) {
        try {
          await modulesAPI.addRow(newMod.id, { data: row, linked_row_ids: [], linked_knowledge_ids: [] });
        } catch {}
      }
      Alert.alert(
        'Loaded into Learning Mode!',
        `"${selectedItem.title}" is now a module with ${rows.length} rows.`,
        [
          { text: 'Go to Learn', onPress: () => router.navigate('/(tabs)/learn') },
          { text: 'Stay', style: 'cancel' },
        ]
      );
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.detail ?? 'Could not load into module.');
    }
    setLoadingIntoModule(false);
  };

  // ── Like / Comment (public) ──────────────────────────────────────────────────

  const toggleLike = (item: PublicItem) => {
    const updated = new Set(likedIds);
    if (updated.has(item.id)) {
      updated.delete(item.id);
    } else {
      updated.add(item.id);
      marketplaceAPI.rate(item.id, 5).catch(() => {});
    }
    setLikedIds(updated);
  };

  const openComment = (item: PublicItem) => {
    setCommentTarget(item);
    setCommentText('');
    setShowCommentModal(true);
  };

  const buyItem = (item: PublicItem) => {
    if (item.price === 0) {
      marketplaceAPI.purchase(item.id)
        .then(({ data }) => Alert.alert('Added to Library', `"${data.title}" is now in your private library.`))
        .catch(() => Alert.alert('Error', 'Could not download.'));
    } else {
      router.push(`/payment?amount=${item.price}&description=${encodeURIComponent(item.title)}&knowledgeId=${item.id}`);
    }
  };

  const renderPrivateItem = ({ item }: { item: KnowledgeItem }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => { setSelectedItem(item); setShowDetail(true); }}
      onLongPress={() => openOptions(item)}
      activeOpacity={0.75}
    >
      <View style={styles.cardRow}>
        <View style={[styles.cardIcon, item.is_public && { backgroundColor: Colors.success }]}>
          <Ionicons
            name={(CATEGORY_ICONS[item.category] ?? 'bookmark-outline') as any}
            size={17}
            color={Colors.white}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.cardSummary} numberOfLines={2}>{item.summary}</Text>
          <View style={styles.cardMeta}>
            <Text style={styles.metaChip}>{item.category}</Text>
            {item.is_public && (
              <View style={styles.publicBadge}>
                <Ionicons name="earth" size={10} color={Colors.success} />
                <Text style={styles.publicBadgeText}>Public</Text>
              </View>
            )}
            {item.tags.slice(0, 2).map((t) => (
              <Text key={t} style={styles.tagChip}>{t}</Text>
            ))}
          </View>
        </View>
        <TouchableOpacity onPress={() => openOptions(item)} style={styles.moreBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Ionicons name="ellipsis-vertical" size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const renderPublicItem = ({ item }: { item: PublicItem }) => (
    <View style={[styles.card, styles.publicCard]}>
      <View style={styles.cardRow}>
        <View style={[styles.cardIcon, { backgroundColor: Colors.success }]}>
          <Ionicons
            name={(CATEGORY_ICONS[item.category] ?? 'earth-outline') as any}
            size={17}
            color={Colors.white}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.cardSummary} numberOfLines={2}>{item.summary}</Text>
          <View style={styles.cardMeta}>
            <StarRow rating={item.rating} />
            <Text style={styles.metaText}>({item.rating_count})</Text>
            <Text style={styles.metaText}>· {item.author}</Text>
          </View>
        </View>
        {/* Buy / Get column */}
        <View style={styles.buyCol}>
          <Text style={styles.price}>{item.price === 0 ? 'Free' : `$${item.price}`}</Text>
          <TouchableOpacity
            style={[styles.buyBtn, item.price === 0 && styles.getBtnFree]}
            onPress={() => buyItem(item)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={item.price === 0 ? 'cloud-download-outline' : 'cart-outline'}
              size={13}
              color={Colors.white}
            />
            <Text style={styles.buyBtnText}>{item.price === 0 ? 'Get' : 'Buy'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Rate + Like + Comment row */}
      <View style={styles.rateRow}>
        <Text style={styles.rateLabel}>Rate:</Text>
        {[1, 2, 3, 4, 5].map((s) => (
          <TouchableOpacity key={s} onPress={() => rateItem(item, s)} hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}>
            <Ionicons name={item.rating >= s ? 'star' : 'star-outline'} size={20} color={Colors.gold} />
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => toggleLike(item)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Ionicons name={likedIds.has(item.id) ? 'heart' : 'heart-outline'} size={17} color={likedIds.has(item.id) ? Colors.error : Colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => openComment(item)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Ionicons name="chatbubble-outline" size={15} color={Colors.textMuted} />
        </TouchableOpacity>
        <Ionicons name="cloud-download-outline" size={12} color={Colors.textMuted} />
        <Text style={styles.metaText}>{item.download_count}</Text>
      </View>
    </View>
  );

  const privateEmpty = (
    <View style={styles.emptyContainer}>
      <Ionicons name="library-outline" size={52} color={Colors.primaryLight} />
      <Text style={styles.emptyTitle}>Your library is empty</Text>
      <Text style={styles.emptySubtitle}>
        Knowledge is saved here automatically when you:
      </Text>
      <View style={styles.emptyTips}>
        <View style={styles.emptyTip}>
          <Ionicons name="chatbubble-ellipses-outline" size={16} color={Colors.primary} />
          <Text style={styles.emptyTipText}>Ask the AI on the Home screen — answers can be saved</Text>
        </View>
        <View style={styles.emptyTip}>
          <Ionicons name="globe-outline" size={16} color={Colors.primary} />
          <Text style={styles.emptyTipText}>Use "Extract from Web" in Learning Mode to import articles</Text>
        </View>
        <View style={styles.emptyTip}>
          <Ionicons name="mic-outline" size={16} color={Colors.primary} />
          <Text style={styles.emptyTipText}>Record voice notes — transcribed and saved automatically</Text>
        </View>
        <View style={styles.emptyTip}>
          <Ionicons name="document-text-outline" size={16} color={Colors.primary} />
          <Text style={styles.emptyTipText}>Upload files (PDF, TXT) from the Files section</Text>
        </View>
      </View>
    </View>
  );

  const publicEmpty = (
    <View style={styles.emptyContainer}>
      <Ionicons name="earth-outline" size={52} color={Colors.primaryLight} />
      <Text style={styles.emptyTitle}>No results found</Text>
      <Text style={styles.emptySubtitle}>
        Try a different category or clear your search filter.{'\n'}
        You can also publish your own knowledge to the marketplace — tap ··· on any private item.
      </Text>
    </View>
  );

  // Paywall: non-premium users see a gate before browsing the marketplace
  const paywallScreen = (
    <View style={styles.paywallWrap}>
      <View style={styles.paywallIcon}>
        <Ionicons name="earth" size={44} color={Colors.white} />
      </View>
      <Text style={styles.paywallTitle}>Knowledge Marketplace</Text>
      <Text style={styles.paywallSub}>
        A curated marketplace where learners buy structured knowledge and creators earn from their expertise.
      </Text>

      <View style={styles.paywallModelRow}>
        {/* Buyer */}
        <View style={styles.paywallModelCard}>
          <Ionicons name="bag-handle-outline" size={22} color={Colors.primary} />
          <Text style={styles.paywallModelTitle}>Buyer</Text>
          <Text style={styles.paywallModelPrice}>$20 one-time</Text>
          <Text style={styles.paywallModelSub}>Lifetime access · Browse, buy and rate all knowledge</Text>
        </View>
        {/* Creator */}
        <View style={[styles.paywallModelCard, { borderColor: Colors.success }]}>
          <Ionicons name="create-outline" size={22} color={Colors.success} />
          <Text style={[styles.paywallModelTitle, { color: Colors.success }]}>Creator</Text>
          <Text style={[styles.paywallModelPrice, { color: Colors.success }]}>Free to publish</Text>
          <Text style={styles.paywallModelSub}>Set your price · Keep 80% of every sale</Text>
        </View>
      </View>

      <View style={styles.paywallFeatures}>
        {[
          ['earth-outline', 'Browse all published knowledge'],
          ['cart-outline', "Buy individual items at creator's price"],
          ['star-outline', 'Rate and comment on knowledge'],
          ['cloud-upload-outline', 'Publish your own modules — free to list'],
          ['cash-outline', 'Earn: you keep 80%, platform takes 20%'],
        ].map(([icon, text]) => (
          <View key={text} style={styles.paywallFeatureRow}>
            <Ionicons name={icon as any} size={14} color={Colors.primary} />
            <Text style={styles.paywallFeatureTxt}>{text}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        style={styles.paywallBtn}
        onPress={() => router.push('/payment?amount=20.00&description=Marketplace+Access&premium=1')}
      >
        <Ionicons name="lock-open-outline" size={18} color={Colors.white} />
        <Text style={styles.paywallBtnTxt}>Unlock Marketplace — $20</Text>
      </TouchableOpacity>
      <Text style={styles.paywallNote}>One-time payment · Lifetime access · No subscription</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header ── */}
      <AppHeader
        leftActions={[
          { icon: 'search-outline', onPress: () => router.navigate('/(tabs)'), color: Colors.textMuted },
          { icon: 'settings-outline', onPress: () => router.navigate('/(tabs)/settings'), color: Colors.textMuted },
          { icon: 'library', color: Colors.primary, active: true },           // Knowledge — active
          { icon: 'book-outline', onPress: () => router.navigate('/(tabs)/learn'), color: Colors.textMuted },
        ]}
        rightActions={[
          { icon: 'git-network-outline', onPress: () => router.push('/graph'), color: Colors.textMuted },
        ]}
      />

      {/* ── Private / Public Tabs ── */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'private' && styles.tabBtnActive]}
          onPress={() => setTab('private')}
        >
          <Ionicons
            name="lock-closed-outline"
            size={15}
            color={tab === 'private' ? Colors.white : Colors.primary}
          />
          <Text style={[styles.tabBtnText, tab === 'private' && styles.tabBtnTextActive]}>
            My Library
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'public' && styles.tabBtnActive]}
          onPress={() => setTab('public')}
        >
          <Ionicons
            name="earth-outline"
            size={15}
            color={tab === 'public' ? Colors.white : Colors.primary}
          />
          <Text style={[styles.tabBtnText, tab === 'public' && styles.tabBtnTextActive]}>
            Marketplace
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Search ── */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder={tab === 'private' ? 'Search your library…' : 'Search marketplace…'}
          value={search}
          onChangeText={setSearch}
          placeholderTextColor={Colors.textMuted}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ── Category Filter ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 7 }}
        style={{ maxHeight: 50 }}
      >
        {CATEGORIES.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.catChip, category === c && styles.catChipActive]}
            onPress={() => setCategory(c)}
          >
            <Ionicons
              name={(CATEGORY_ICONS[c] ?? 'bookmark-outline') as any}
              size={11}
              color={category === c ? Colors.white : Colors.textMuted}
            />
            <Text style={[styles.catChipText, category === c && styles.catChipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── List ── */}
      {tab === 'public' && !user?.is_premium ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
          {paywallScreen}
        </ScrollView>
      ) : loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={(tab === 'private' ? privateItems : publicItems) as any[]}
          keyExtractor={(item) => item.id.toString()}
          renderItem={tab === 'private' ? renderPrivateItem : renderPublicItem as any}
          contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 40 }}
          ListEmptyComponent={tab === 'private' ? privateEmpty : publicEmpty}
        />
      )}

      {/* ── Options Modal ── */}
      <Modal visible={showOptions} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle} numberOfLines={1}>{selectedItem?.title}</Text>
            <Text style={styles.modalSubtitle}>{selectedItem?.category}</Text>
            <TouchableOpacity style={styles.optionItem} onPress={openRename}>
              <View style={[styles.optionIconWrap, { backgroundColor: '#FFF8E1' }]}>
                <Ionicons name="pencil-outline" size={19} color={Colors.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionText}>Rename</Text>
                <Text style={styles.optionDesc}>Change the title of this knowledge item</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionItem} onPress={loadIntoModule} disabled={loadingIntoModule}>
              <View style={[styles.optionIconWrap, { backgroundColor: '#E8F5E9' }]}>
                {loadingIntoModule
                  ? <ActivityIndicator size="small" color={Colors.success} />
                  : <Ionicons name="grid-outline" size={19} color={Colors.success} />
                }
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionText}>Load into Learning Mode</Text>
                <Text style={styles.optionDesc}>Open as a module table for editing</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionItem} onPress={publishItem}>
              <View style={[styles.optionIconWrap, { backgroundColor: '#EEF4FF' }]}>
                <Ionicons name="earth-outline" size={19} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionText}>Publish to Marketplace</Text>
                <Text style={styles.optionDesc}>Make this visible to other users</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.optionItem} onPress={deleteItem}>
              <View style={[styles.optionIconWrap, { backgroundColor: '#FFF0F0' }]}>
                <Ionicons name="trash-outline" size={19} color={Colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionText, { color: Colors.error }]}>Delete</Text>
                <Text style={styles.optionDesc}>Permanently remove from your library</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowOptions(false)}>
              <Text style={{ color: Colors.textSecondary, textAlign: 'center', fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Publish Modal ── */}
      <Modal visible={showPublishModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Publish to Marketplace</Text>

            {/* Creator model info */}
            <View style={styles.creatorModelBox}>
              <View style={styles.creatorModelRow}>
                <Ionicons name="cash-outline" size={15} color={Colors.success} />
                <Text style={styles.creatorModelTxt}>
                  <Text style={{ fontWeight: '700' }}>You keep 80%</Text> of every sale — platform takes 20%
                </Text>
              </View>
              <View style={styles.creatorModelRow}>
                <Ionicons name="people-outline" size={15} color={Colors.primary} />
                <Text style={styles.creatorModelTxt}>
                  Visible to all <Text style={{ fontWeight: '700' }}>marketplace members</Text> worldwide
                </Text>
              </View>
              <View style={styles.creatorModelRow}>
                <Ionicons name="pricetag-outline" size={15} color={Colors.textMuted} />
                <Text style={styles.creatorModelTxt}>
                  Set <Text style={{ fontWeight: '700' }}>0</Text> to share for free · any price to earn
                </Text>
              </View>
            </View>

            <Text style={styles.priceLabel}>Your Price (USD)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 4.99   or   0 for free"
              value={publishPrice}
              onChangeText={setPublishPrice}
              keyboardType="decimal-pad"
              placeholderTextColor={Colors.textMuted}
            />
            {parseFloat(publishPrice) > 0 && (
              <Text style={styles.earningsHint}>
                You earn ${(parseFloat(publishPrice) * 0.8).toFixed(2)} per sale
              </Text>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn2} onPress={() => setShowPublishModal(false)}>
                <Text style={{ color: Colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirmPublish}>
                <Text style={{ color: Colors.white, fontWeight: '700' }}>Publish</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Rename Modal ── */}
      <Modal visible={showRenameModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="New title"
              value={renameTitle}
              onChangeText={setRenameTitle}
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn2} onPress={() => setShowRenameModal(false)}>
                <Text style={{ color: Colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirmRename} disabled={renameLoading}>
                {renameLoading
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={{ color: Colors.white, fontWeight: '700' }}>Save</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Comment Modal ── */}
      <Modal visible={showCommentModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Comment</Text>
            <Text style={styles.modalSubtitle} numberOfLines={1}>{commentTarget?.title}</Text>
            <TextInput
              style={[styles.modalInput, { height: 100, textAlignVertical: 'top' }]}
              placeholder="Share your thoughts…"
              value={commentText}
              onChangeText={setCommentText}
              placeholderTextColor={Colors.textMuted}
              multiline
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn2} onPress={() => setShowCommentModal(false)}>
                <Text style={{ color: Colors.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmBtn}
                onPress={() => {
                  setShowCommentModal(false);
                  Alert.alert('Comment submitted', 'Your comment has been recorded.');
                }}
              >
                <Text style={{ color: Colors.white, fontWeight: '700' }}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Detail Modal ── */}
      <Modal visible={showDetail} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '82%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <Text style={[styles.modalTitle, { flex: 1 }]} numberOfLines={3}>
                {selectedItem?.title}
              </Text>
              <TouchableOpacity onPress={() => setShowDetail(false)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Ionicons name="close-circle" size={24} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
              <Text style={styles.metaChip}>{selectedItem?.category}</Text>
              {selectedItem?.is_public && (
                <View style={styles.publicBadge}>
                  <Ionicons name="earth" size={10} color={Colors.success} />
                  <Text style={styles.publicBadgeText}>Public</Text>
                </View>
              )}
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              <Text style={styles.detailSummary}>{selectedItem?.summary}</Text>
              {selectedItem?.tags.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
                  {selectedItem.tags.map((t) => <Text key={t} style={styles.tagChip}>{t}</Text>)}
                </View>
              ) : null}
            </ScrollView>
            <TouchableOpacity
              style={[styles.confirmBtn, { marginTop: 4 }]}
              onPress={() => { setShowDetail(false); if (selectedItem) openOptions(selectedItem); }}
            >
              <Text style={{ color: Colors.white, fontWeight: '700' }}>Manage</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  tabBar: {
    flexDirection: 'row', padding: 10, gap: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  tabBtnActive: { backgroundColor: Colors.primary },
  tabBtnText: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.primary },
  tabBtnTextActive: { color: Colors.white },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 12, marginTop: 10,
    backgroundColor: Colors.surface, borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  searchInput: { flex: 1, fontSize: FontSizes.base, color: Colors.textPrimary },

  catChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  catChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  catChipText: { fontSize: 11, color: Colors.textSecondary, fontWeight: '600' },
  catChipTextActive: { color: Colors.white },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Empty states
  emptyContainer: {
    alignItems: 'center', paddingHorizontal: 24, paddingVertical: 32, gap: 12,
  },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  emptySubtitle: { fontSize: FontSizes.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  emptyTips: {
    width: '100%', backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: 14, gap: 10, ...Shadow.sm, marginTop: 4,
  },
  emptyTip: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  emptyTipText: { flex: 1, fontSize: FontSizes.sm, color: Colors.textPrimary, lineHeight: 20 },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: 14,
    ...Shadow.sm,
  },
  publicCard: {
    borderLeftWidth: 3,
    borderLeftColor: Colors.success,
  },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardIcon: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', flexShrink: 0,
  },
  cardTitle: { fontSize: FontSizes.base, fontWeight: '700', color: Colors.textPrimary, marginBottom: 3 },
  cardSummary: { fontSize: FontSizes.sm, color: Colors.textSecondary, lineHeight: 18 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  metaChip: {
    fontSize: 11, color: Colors.primary, backgroundColor: '#EEF4FF',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full, fontWeight: '600',
  },
  tagChip: {
    fontSize: 11, color: Colors.textMuted, backgroundColor: Colors.background,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  publicBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#E8F5E9', paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.full,
  },
  publicBadgeText: { fontSize: 10, color: Colors.success, fontWeight: '700' },
  metaText: { fontSize: 11, color: Colors.textMuted },
  moreBtn: { padding: 4, marginTop: 2 },

  // Buy/Get column
  buyCol: { alignItems: 'center', gap: 6, minWidth: 62, justifyContent: 'center' },
  price: { fontSize: 13, fontWeight: '800', color: Colors.primary },
  buyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Radius.full, minWidth: 58,
  },
  getBtnFree: { backgroundColor: Colors.success },
  buyBtnText: { color: Colors.white, fontSize: 12, fontWeight: '700' },

  rateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginTop: 10, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  rateLabel: { fontSize: 12, color: Colors.textMuted, marginRight: 2 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, gap: 12,
  },
  modalTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.textPrimary },
  modalSubtitle: { fontSize: FontSizes.sm, color: Colors.textSecondary, lineHeight: 18 },
  optionItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  optionIconWrap: {
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
  },
  optionText: { fontSize: FontSizes.base, color: Colors.textPrimary, fontWeight: '600' },
  optionDesc: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  cancelBtn: {
    paddingVertical: 13, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, marginTop: 4,
  },
  cancelBtn2: {
    flex: 1, paddingVertical: 12, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  confirmBtn: {
    flex: 1, paddingVertical: 12, borderRadius: Radius.md,
    backgroundColor: Colors.primary, alignItems: 'center',
  },
  modalInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: FontSizes.base, color: Colors.textPrimary,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  detailSummary: { fontSize: FontSizes.base, color: Colors.textPrimary, lineHeight: 24 },

  // Creator publish model
  creatorModelBox: {
    backgroundColor: '#F0FFF4', borderRadius: Radius.sm, padding: 12, gap: 8,
    borderWidth: 1, borderColor: '#A5D6A7',
  },
  creatorModelRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  creatorModelTxt: { flex: 1, fontSize: 12, color: Colors.textPrimary, lineHeight: 18 },
  priceLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  earningsHint: {
    fontSize: 12, color: Colors.success, fontWeight: '600', textAlign: 'center', marginTop: -6,
  },

  // Paywall
  paywallWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 20, paddingVertical: 28, gap: 14 },
  paywallIcon: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
    ...Shadow.md,
  },
  paywallTitle: { fontSize: FontSizes.xl, fontWeight: '900', color: Colors.textPrimary, textAlign: 'center' },
  paywallSub: { fontSize: FontSizes.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  // Two-column model cards
  paywallModelRow: { flexDirection: 'row', gap: 10, width: '100%' },
  paywallModelCard: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md,
    padding: 12, alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: Colors.border, ...Shadow.sm,
  },
  paywallModelTitle: { fontSize: FontSizes.sm, fontWeight: '800', color: Colors.primary },
  paywallModelPrice: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  paywallModelSub: { fontSize: 10, color: Colors.textSecondary, textAlign: 'center', lineHeight: 14 },
  paywallFeatures: {
    width: '100%', backgroundColor: Colors.surface,
    borderRadius: Radius.md, padding: 14, gap: 10, ...Shadow.sm,
  },
  paywallFeatureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  paywallFeatureTxt: { flex: 1, fontSize: 12, color: Colors.textPrimary, lineHeight: 18 },
  paywallBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 14, paddingHorizontal: 24, width: '100%', ...Shadow.md,
  },
  paywallBtnTxt: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '800' },
  paywallNote: { fontSize: 11, color: Colors.textMuted },
});
