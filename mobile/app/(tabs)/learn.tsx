/**
 * Learning Mode — Card List + vis-network Graph
 *
 * Two views:
 *   LIST  — vertical card stack, edit data, tap 🔗 to link
 *   GRAPH — vis-network force-directed canvas, tap nodes to link
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
  Modal, Alert, ActivityIndicator, Share, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import VisNetwork, { type VisNetworkRef } from 'react-native-vis-network';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Radius, Shadow, FontSizes } from '../../constants/theme';
import { modulesAPI, knowledgeAPI } from '../../services/api';
import { useRouter } from 'expo-router';
import AppHeader from '../../components/AppHeader';

// ── Types ────────────────────────────────────────────────────────────────────

interface Column { name: string; type: 'text' | 'number' | 'date' | 'url' }
interface Row {
  id: number;
  position: number;
  data: Record<string, string>;
  linked_row_ids: number[];
  linked_knowledge_ids: number[];
}
interface Module {
  id: number;
  name: string;
  description: string;
  column_definitions: Column[];
  rows: Row[];
}
interface LinkSuggestion { from_row_id: number; to_row_id: number; reason: string }

// ── Constants ────────────────────────────────────────────────────────────────

const LINK_COLORS = ['#3B52CC', '#00897B', '#E91E63', '#F57C00', '#8D6E63', '#43A047'];
const MODULE_COLORS = ['#3B52CC', '#00897B', '#E91E63', '#F57C00', '#8D6E63'];
const AI_ROW_COUNTS = [3, 5, 8, 10];

function lc(i: number) { return LINK_COLORS[i % LINK_COLORS.length]; }

// ── Link metadata helpers ────────────────────────────────────────────────────

const LINKMETA_KEY = '__lm__';   // { [targetId]: { label, s } }  within-module
const XLINKS_KEY   = '__xl__';   // CrossLink[]                    cross-module

const LABEL_PRESETS = [
  'relates to', 'leads to', 'same type', 'depends on',
  'supports', 'contradicts', 'part of', 'causes',
];

const STRENGTH = [
  { s: 1, label: 'Weak',   icon: 'remove-outline',       color: '#94A3B8', width: 1.5 },
  { s: 2, label: 'Medium', icon: 'reorder-two-outline',  color: '#3B52CC', width: 2.5 },
  { s: 3, label: 'Strong', icon: 'reorder-four-outline', color: '#E91E63', width: 4.0 },
];

interface LinkMeta  { label: string; s: number }
interface CrossLink { mid: number; rid: number; label: string; s: number }

function getLinkMeta(row: Row, targetId: number): LinkMeta {
  try {
    const map = JSON.parse(row.data[LINKMETA_KEY] || '{}');
    const v = map[String(targetId)];
    if (typeof v === 'object') return v;
    // backward-compat with old __labels__ string
    const old = JSON.parse(row.data['__labels__'] || '{}')[String(targetId)];
    return { label: old || '', s: 2 };
  } catch { return { label: '', s: 2 }; }
}

function getLinkLabel(row: Row, targetId: number): string {
  return getLinkMeta(row, targetId).label;
}

function getCrossLinks(row: Row): CrossLink[] {
  try { return JSON.parse(row.data[XLINKS_KEY] || '[]'); }
  catch { return []; }
}

// ── vis-network options (stable reference, defined outside component) ─────────

const VIS_OPTIONS = {
  physics: {
    solver: 'barnesHut',
    barnesHut: {
      gravitationalConstant: -8000,
      centralGravity: 0.3,
      springLength: 150,
      springConstant: 0.04,
      damping: 0.09,
      avoidOverlap: 0.2,
    },
    stabilization: { iterations: 200, updateInterval: 25 },
    adaptiveTimestep: true,
  },
  nodes: {
    shape: 'box',
    borderWidth: 2,
    shadow: { enabled: true, size: 5, x: 0, y: 3, color: 'rgba(0,0,0,0.12)' },
    font: { size: 13, face: 'system-ui, sans-serif', color: '#1E293B' },
    widthConstraint: { minimum: 100, maximum: 160 },
    heightConstraint: { minimum: 36 },
    margin: { top: 9, right: 13, bottom: 9, left: 13 },
  },
  edges: {
    arrows: { to: { enabled: true, scaleFactor: 0.65 } },
    smooth: { enabled: true, type: 'curvedCW', roundness: 0.2 },
    font: { size: 11, align: 'middle', background: 'rgba(255,255,255,0.9)' },
    selectionWidth: 2.5,
  },
  interaction: {
    dragNodes: true,
    dragView: true,
    zoomView: false,   // disabled — Android WebView mis-fires pinch after node tap
    hover: true,
    multiselect: false,
  },
  layout: { improvedLayout: true },
};

// ── Component ────────────────────────────────────────────────────────────────

export default function LearnScreen() {
  const router = useRouter();
  const [modules, setModules] = useState<{ id: number; name: string }[]>([]);
  const [activeModule, setActiveModule] = useState<Module | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('graph');

  // Linking
  const [linkSourceRow, setLinkSourceRow] = useState<Row | null>(null);
  const [showLinkPicker, setShowLinkPicker] = useState(false);

  // Graph — vis-network
  const visRef = useRef<VisNetworkRef>(null);
  const activeModuleRef = useRef<Module | null>(null);
  const graphSelectedRef = useRef<number | null>(null);
  const [graphSelected, setGraphSelected] = useState<number | null>(null);
  const [graphLinkMode, setGraphLinkMode] = useState(false);
  const graphLinkModeRef = useRef(false);
  // Stable refs so WebView event callbacks never see stale closures
  const hasInitFitRef = useRef(false);
  const toggleLinkRef = useRef<(source: Row, targetId: number) => Promise<void>>(async () => {});

  // Manual zoom state (replaces pinch-zoom which causes Android WebView touch bug)
  const [graphScale, setGraphScale] = useState(1);

  // Link label + strength modal
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [pendingLink, setPendingLink] = useState<{ source: Row; targetId: number } | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newStrength, setNewStrength] = useState(2);

  // Cross-module linking
  const [showCrossLink, setShowCrossLink] = useState(false);
  const [crossSource, setCrossSource] = useState<Row | null>(null);
  const [crossStep, setCrossStep] = useState<'module' | 'row'>('module');
  const [crossLabel, setCrossLabel] = useState('');
  const [crossStrength, setCrossStrength] = useState(2);
  const [crossModFull, setCrossModFull] = useState<Module | null>(null);

  // Analytics
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Export
  const [showExport, setShowExport] = useState(false);

  // Save MODULE to Knowledge Library (modules are the publishable unit, not individual rows)
  const [showSaveModule, setShowSaveModule] = useState(false);
  const [saveModulePublic, setSaveModulePublic] = useState(false);
  const [saveModulePrice, setSaveModulePrice] = useState('0');
  const [saveModuleCategory, setSaveModuleCategory] = useState('General');
  const [saveModuleLoading, setSaveModuleLoading] = useState(false);

  // Modals
  const [showNewModule, setShowNewModule] = useState(false);
  const [newModName, setNewModName] = useState('');
  const [newModDesc, setNewModDesc] = useState('');
  const [showAddCol, setShowAddCol] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [showEditRow, setShowEditRow] = useState(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [editData, setEditData] = useState<Record<string, string>>({});

  // AI
  const [showAIPanel, setShowAIPanel] = useState(false);
  type AIMode = 'generate' | 'suggest' | 'fill' | 'create' | 'demo' | null;
  const [aiMode, setAIMode] = useState<AIMode>(null);
  const [aiLoading, setAILoading] = useState(false);
  const [fillingRowIds, setFillingRowIds] = useState<Set<number>>(new Set()); // per-row fill tracking
  const [rowSearch, setRowSearch] = useState('');           // filter rows in list view
  const [pickingImageRow, setPickingImageRow] = useState<number | null>(null); // which row is getting an image
  const [aiPrompt, setAIPrompt] = useState('');
  const [aiRowCount, setAIRowCount] = useState(5);
  const [aiSuggestions, setAISuggestions] = useState<LinkSuggestion[]>([]);
  const [aiSuggIdx, setAISuggIdx] = useState(0);
  const [aiFillRows, setAIFillRows] = useState<Row[]>([]);

  useEffect(() => { loadModules(); }, []);

  // ── Data ──────────────────────────────────────────────────────────────────

  const loadModules = async () => {
    try {
      const { data } = await modulesAPI.list();
      setModules(data);
      if (data.length > 0 && !activeModule) loadModule(data[0].id);
    } catch { }
  };

  const loadModule = async (id: number) => {
    setLoading(true);
    try {
      const { data } = await modulesAPI.get(id);
      setActiveModule(data);
      activeModuleRef.current = data;
      setGraphSelected(null);
      graphSelectedRef.current = null;
    } catch { }
    setLoading(false);
  };

  // ── Module CRUD ───────────────────────────────────────────────────────────

  const createModule = async () => {
    if (!newModName.trim()) return;
    try {
      const { data } = await modulesAPI.create({
        name: newModName.trim(),
        description: newModDesc.trim(),
        column_definitions: [
          { name: 'Title', type: 'text' },
          { name: 'Notes', type: 'text' },
        ],
      });
      setShowNewModule(false); setNewModName(''); setNewModDesc('');
      await loadModules();
      loadModule(data.id);
    } catch { Alert.alert('Error', 'Could not create module.'); }
  };

  const deleteModule = (id: number) => {
    Alert.alert('Delete Module', 'Delete this module and all its rows?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await modulesAPI.delete(id);
        setActiveModule(null);
        loadModules();
      }},
    ]);
  };

  // ── Row CRUD ──────────────────────────────────────────────────────────────

  const addRow = async () => {
    if (!activeModule) return;
    const empty: Record<string, string> = {};
    activeModule.column_definitions.forEach(c => { empty[c.name] = ''; });
    try {
      await modulesAPI.addRow(activeModule.id, { data: empty, linked_row_ids: [], linked_knowledge_ids: [] });
      const { data: mod } = await modulesAPI.get(activeModule.id);
      setActiveModule(mod);
      setActiveModule(mod);
      activeModuleRef.current = mod;
    } catch { }
  };

  const deleteRow = (rowId: number) => {
    Alert.alert('Delete', 'Remove this entry?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (!activeModule) return;
        await modulesAPI.deleteRow(activeModule.id, rowId);
        loadModule(activeModule.id);
      }},
    ]);
  };

  const openEditRow = (row: Row) => {
    setEditRow(row);
    setEditData({ ...row.data });
    setShowEditRow(true);
  };

  const saveEditRow = async () => {
    if (!activeModule || !editRow) return;
    try {
      await modulesAPI.updateRow(activeModule.id, editRow.id, {
        data: editData,
        linked_row_ids: editRow.linked_row_ids,
        linked_knowledge_ids: editRow.linked_knowledge_ids,
      });
      setActiveModule(prev => prev ? {
        ...prev,
        rows: prev.rows.map(r => r.id === editRow.id ? { ...r, data: editData } : r),
      } : prev);
      setShowEditRow(false);
    } catch { Alert.alert('Error', 'Could not save.'); }
  };

  // ── Image attachment per row ──────────────────────────────────────────────────

  const pickRowImage = async (row: Row) => {
    if (!activeModule) return;
    setPickingImageRow(row.id);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to attach images.');
        setPickingImageRow(null);
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
      });
      if (!result.canceled && result.assets?.length) {
        const uri = result.assets[0].uri;
        const newData = { ...row.data, __image__: uri };
        await modulesAPI.updateRow(activeModule.id, row.id, {
          data: newData,
          linked_row_ids: row.linked_row_ids,
          linked_knowledge_ids: row.linked_knowledge_ids,
        });
        setActiveModule(prev => prev ? {
          ...prev,
          rows: prev.rows.map(r => r.id === row.id ? { ...r, data: newData } : r),
        } : prev);
      }
    } catch { Alert.alert('Error', 'Could not attach image.'); }
    setPickingImageRow(null);
  };

  const addColumn = async () => {
    if (!activeModule || !newColName.trim()) return;
    const name = newColName.trim();
    try {
      for (const row of activeModule.rows) {
        await modulesAPI.updateRow(activeModule.id, row.id, {
          data: { ...row.data, [name]: '' },
          linked_row_ids: row.linked_row_ids,
          linked_knowledge_ids: row.linked_knowledge_ids,
        });
      }
      setActiveModule(prev => prev ? {
        ...prev,
        column_definitions: [...prev.column_definitions, { name, type: 'text' }],
      } : prev);
      setShowAddCol(false); setNewColName('');
    } catch { }
  };

  // ── Linking ───────────────────────────────────────────────────────────────

  const rowLabel = (row: Row) => {
    const col = activeModule?.column_definitions[0]?.name;
    const val = col ? row.data[col] : '';
    return val?.trim() || `Entry ${row.position + 1}`;
  };

  /** Toggle link between two rows */
  const toggleLink = async (source: Row, targetId: number) => {
    if (!activeModule) return;
    const already = source.linked_row_ids.includes(targetId);
    const newLinks = already
      ? source.linked_row_ids.filter(id => id !== targetId)
      : [...source.linked_row_ids, targetId];
    try {
      await modulesAPI.updateRow(activeModule.id, source.id, {
        data: source.data,
        linked_row_ids: newLinks,
        linked_knowledge_ids: source.linked_knowledge_ids,
      });
      setActiveModule(prev => prev ? {
        ...prev,
        rows: prev.rows.map(r => r.id === source.id ? { ...r, linked_row_ids: newLinks } : r),
      } : prev);
      if (source.id === linkSourceRow?.id) {
        setLinkSourceRow(prev => prev ? { ...prev, linked_row_ids: newLinks } : prev);
      }
    } catch { Alert.alert('Error', 'Could not update link.'); }
  };

  const saveLinkMeta = async (source: Row, targetId: number, label: string, s: number) => {
    if (!activeModule) return;
    let map: Record<string, LinkMeta> = {};
    try { map = JSON.parse(source.data[LINKMETA_KEY] || '{}'); } catch {}
    map[String(targetId)] = { label: label.trim() || 'relates to', s };
    const newData = { ...source.data, [LINKMETA_KEY]: JSON.stringify(map) };
    try {
      await modulesAPI.updateRow(activeModule.id, source.id, {
        data: newData, linked_row_ids: source.linked_row_ids,
        linked_knowledge_ids: source.linked_knowledge_ids,
      });
      setActiveModule(prev => prev ? {
        ...prev, rows: prev.rows.map(r => r.id === source.id ? { ...r, data: newData } : r),
      } : prev);
    } catch {}
  };

  const confirmLabel = async () => {
    if (!pendingLink) return;
    await saveLinkMeta(pendingLink.source, pendingLink.targetId, newLabel, newStrength);
    setShowLabelModal(false); setPendingLink(null); setNewLabel(''); setNewStrength(2);
  };

  // ── Cross-module linking ───────────────────────────────────────────────────

  const openCrossLink = (row: Row) => {
    setCrossSource(row); setCrossStep('module');
    setCrossModFull(null);
    setCrossLabel(''); setCrossStrength(2);
    setShowCrossLink(true);
  };

  const pickCrossModule = async (mod: { id: number; name: string }) => {
    if (mod.id === activeModule?.id) return; // skip same module
    const { data } = await modulesAPI.get(mod.id);
    setCrossModFull(data);
    setCrossStep('row');
  };

  const addCrossLink = async (targetRow: Row) => {
    if (!activeModule || !crossSource || !crossModFull) return;
    let links = getCrossLinks(crossSource);
    const already = links.find(l => l.mid === crossModFull.id && l.rid === targetRow.id);
    if (already) { setShowCrossLink(false); return; }
    links = [...links, { mid: crossModFull.id, rid: targetRow.id, label: crossLabel || 'relates to', s: crossStrength }];
    const newData = { ...crossSource.data, [XLINKS_KEY]: JSON.stringify(links) };
    try {
      await modulesAPI.updateRow(activeModule.id, crossSource.id, {
        data: newData, linked_row_ids: crossSource.linked_row_ids,
        linked_knowledge_ids: crossSource.linked_knowledge_ids,
      });
      setActiveModule(prev => prev ? {
        ...prev, rows: prev.rows.map(r => r.id === crossSource!.id ? { ...r, data: newData } : r),
      } : prev);
    } catch { Alert.alert('Error', 'Could not save cross-link.'); }
    setShowCrossLink(false);
  };

  const removeCrossLink = async (source: Row, mid: number, rid: number) => {
    if (!activeModule) return;
    const links = getCrossLinks(source).filter(l => !(l.mid === mid && l.rid === rid));
    const newData = { ...source.data, [XLINKS_KEY]: JSON.stringify(links) };
    await modulesAPI.updateRow(activeModule.id, source.id, {
      data: newData, linked_row_ids: source.linked_row_ids,
      linked_knowledge_ids: source.linked_knowledge_ids,
    });
    setActiveModule(prev => prev ? {
      ...prev, rows: prev.rows.map(r => r.id === source.id ? { ...r, data: newData } : r),
    } : prev);
  };

  // ── Analytics ─────────────────────────────────────────────────────────────

  // ── Graph zoom (replaces pinch since zoomView is disabled) ───────────────────

  const zoomIn = () => {
    const s = Math.min(parseFloat((graphScale * 1.35).toFixed(2)), 4);
    setGraphScale(s);
    visRef.current?.moveTo({ scale: s });
  };

  const zoomOut = () => {
    const s = Math.max(parseFloat((graphScale / 1.35).toFixed(2)), 0.15);
    setGraphScale(s);
    visRef.current?.moveTo({ scale: s });
  };

  // ── Analytics ─────────────────────────────────────────────────────────────

  const analytics = (() => {
    if (!activeModule) return null;
    const rows = activeModule.rows;
    const counts = rows.map(r => ({
      row: r,
      label: rowLabel(r),
      intra: r.linked_row_ids.length,
      cross: getCrossLinks(r).length,
      total: r.linked_row_ids.length + getCrossLinks(r).length,
    })).sort((a, b) => b.total - a.total);
    const totalLinks = rows.reduce((s, r) => s + r.linked_row_ids.length, 0);
    const totalCross = rows.reduce((s, r) => s + getCrossLinks(r).length, 0);
    const isolated   = rows.filter(r => r.linked_row_ids.length === 0 && getCrossLinks(r).length === 0);
    const avg = rows.length ? ((totalLinks + totalCross) / rows.length).toFixed(1) : '0';
    return { counts, totalLinks, totalCross, isolated, avg };
  })();

  // ── Export ───────────────────────────────────────────────────────────────

  const exportJSON = async () => {
    if (!activeModule) return;
    const cols = activeModule.column_definitions.map(c => c.name);
    const exportObj = {
      module: activeModule.name,
      description: activeModule.description,
      columns: cols,
      rows: activeModule.rows.map(r => {
        const d: Record<string, string> = {};
        cols.forEach(c => { d[c] = r.data[c] || ''; });
        return { position: r.position, data: d, links: r.linked_row_ids.length };
      }),
      exported_at: new Date().toISOString(),
    };
    try {
      await Share.share({
        message: JSON.stringify(exportObj, null, 2),
        title: `${activeModule.name}.json`,
      });
    } catch { /* user dismissed */ }
  };

  const exportCSV = async () => {
    if (!activeModule) return;
    const cols = activeModule.column_definitions.map(c => c.name);
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      cols.map(escape).join(','),
      ...activeModule.rows.map(r => cols.map(c => escape(r.data[c] || '')).join(',')),
    ];
    try {
      await Share.share({
        message: lines.join('\n'),
        title: `${activeModule.name}.csv`,
      });
    } catch { /* user dismissed */ }
  };

  // ── Save MODULE to Knowledge Library ─────────────────────────────────────
  // A module (table + links) is the publishable knowledge artifact — not individual rows.

  const MODULE_CATEGORIES = [
    'General','Science','History','Technology','Personal',
    'Health','Business','Language','Art','Mathematics',
  ];

  const openSaveModule = () => {
    if (!activeModule) return;
    setSaveModulePublic(false);
    setSaveModulePrice('0');
    setSaveModuleCategory('General');
    setShowSaveModule(true);
  };

  const confirmSaveModule = async () => {
    if (!activeModule) return;
    setSaveModuleLoading(true);
    const cols = activeModule.column_definitions.filter(c => !c.name.startsWith('__'));
    const header = cols.map(c => c.name).join(' | ');
    const separator = cols.map(() => '---').join(' | ');
    const rows = activeModule.rows.map(r => {
      const cells = cols.map(c => r.data[c.name]?.trim() || '—').join(' | ');
      const links = r.linked_row_ids.length > 0
        ? ` → [${r.linked_row_ids.map(tid => {
            const t = activeModule.rows.find(x => x.id === tid);
            return t ? rowLabel(t) : tid;
          }).join(', ')}]`
        : '';
      return cells + links;
    }).join('\n');
    const content = `# ${activeModule.name}\n${activeModule.description ? activeModule.description + '\n\n' : ''}`
      + `## Structure (${activeModule.rows.length} entries, ${activeModule.rows.reduce((s, r) => s + r.linked_row_ids.length, 0)} links)\n`
      + `${header}\n${separator}\n${rows}`;
    const summary = `${activeModule.description || activeModule.name} — ${activeModule.rows.length} entries with ${activeModule.rows.reduce((s, r) => s + r.linked_row_ids.length, 0)} connections.`;
    try {
      const { data: item } = await knowledgeAPI.create({
        title: activeModule.name,
        content,
        category: saveModuleCategory,
        summary,
        source_type: 'module',
      });
      if (saveModulePublic) {
        const price = Math.max(0, parseFloat(saveModulePrice) || 0);
        await knowledgeAPI.publish(item.id, price);
      }
      setShowSaveModule(false);
      Alert.alert(
        'Saved to Knowledge Library!',
        `"${activeModule.name}" with ${activeModule.rows.length} entries has been saved.\n` +
        (saveModulePublic
          ? `Listed on marketplace${parseFloat(saveModulePrice) > 0 ? ` for $${saveModulePrice}` : ' for free'}.`
          : 'Saved as private.'),
      );
    } catch { Alert.alert('Error', 'Could not save to Knowledge Library.'); }
    setSaveModuleLoading(false);
  };

  // ── Graph: keep refs in sync ──────────────────────────────────────────────

  useEffect(() => { activeModuleRef.current = activeModule; }, [activeModule]);
  useEffect(() => { graphSelectedRef.current = graphSelected; }, [graphSelected]);
  useEffect(() => { graphLinkModeRef.current = graphLinkMode; }, [graphLinkMode]);
  // Keep toggleLink ref fresh so WebView callbacks always call the latest version
  useEffect(() => { toggleLinkRef.current = toggleLink; });
  // Reset "has done initial fit" and zoom scale whenever we switch to a different module
  useEffect(() => { hasInitFitRef.current = false; setGraphScale(1); }, [activeModule?.id]);

  // ── Graph: vis-network event wiring ──────────────────────────────────────

  const setupVisEvents = () => {
    if (!visRef.current) return;

    // Fit to screen once — on first stabilization only.
    // After that, never auto-fit again so user pan/zoom is preserved.
    visRef.current.addEventListener('stabilized', () => {
      if (!hasInitFitRef.current) {
        hasInitFitRef.current = true;
        visRef.current?.fit();
      }
    });

    // Use a single 'click' event instead of separate selectNode + deselectNode.
    //
    // WHY: vis-network fires events in this order when tapping a DIFFERENT node:
    //   1. selectNode(newNode)  → sets graphSelected = newNode
    //   2. deselectNode(oldNode) → sets graphSelected = null  ← WIPES the new selection!
    //
    // Using 'click' avoids this entirely — one event, one source of truth.
    //   params.nodes[0] → the tapped node id (or undefined if canvas was tapped)
    visRef.current.addEventListener('click', async (params: any) => {
      const tappedId = Number(params?.nodes?.[0]) || null;
      const mod = activeModuleRef.current;
      if (!mod) return;

      if (graphLinkModeRef.current) {
        // Link-mode: tap a target node to create the link
        const firstId = graphSelectedRef.current;
        if (tappedId && firstId && firstId !== tappedId) {
          const sourceRow = mod.rows.find(r => r.id === firstId);
          const targetRow = mod.rows.find(r => r.id === tappedId);
          if (sourceRow && targetRow) {
            const alreadyLinked = sourceRow.linked_row_ids.includes(targetRow.id);
            await toggleLinkRef.current(sourceRow, targetRow.id);
            if (!alreadyLinked) {
              setPendingLink({
                source: { ...sourceRow, linked_row_ids: [...sourceRow.linked_row_ids, targetRow.id] },
                targetId: targetRow.id,
              });
              setNewLabel('');
              setShowLabelModal(true);
            }
          }
        }
        setGraphSelected(null);
        graphSelectedRef.current = null;
        setGraphLinkMode(false);
        visRef.current?.unselectAll();
      } else {
        if (tappedId) {
          // Node tapped — show info panel
          setGraphSelected(tappedId);
          graphSelectedRef.current = tappedId;
        } else {
          // Canvas tapped — close panel and visually deselect in vis-network
          setGraphSelected(null);
          graphSelectedRef.current = null;
          visRef.current?.unselectAll();
        }
      }
    });
  };

  // ── Build vis-network data from active module ────────────────────────────

  const buildVisData = () => {
    if (!activeModule) return { nodes: [], edges: [] };
    let ci = 0;

    // Compute degree (inbound + outbound) for each row
    const degreeOf = (rowId: number) => {
      const r = activeModule.rows.find(x => x.id === rowId);
      if (!r) return 0;
      let d = r.linked_row_ids.length;
      activeModule.rows.forEach(x => { if (x.linked_row_ids.includes(rowId)) d++; });
      return d;
    };

    const nodes = activeModule.rows.map(row => {
      const hasLinks = row.linked_row_ids.length > 0;
      const hasCross = getCrossLinks(row).length > 0;
      const deg = degreeOf(row.id);
      const isHub = deg >= 4;
      const isStart = row.position === 0;  // entry point indicator
      const color = isHub ? '#FF6B6B' : (isStart ? '#4CAF50' : (hasLinks ? lc(row.position % 6) : '#94A3B8'));
      // Position prefix makes the graph readable: ▶ = start, numbers = order
      const baseLabel = rowLabel(row) + (hasCross ? ' ↗' : '');
      const label = isStart ? `▶  ${baseLabel}` : `${row.position + 1}.  ${baseLabel}`;
      return {
        id: row.id,
        label,
        color: {
          background: isHub ? '#FFF0EE' : (isStart ? '#F0FFF4' : (hasLinks ? color + '18' : '#F8FAFF')),
          border: color,
          highlight: { background: '#FFF3B0', border: Colors.gold },
          hover:     { background: color + '30', border: color },
        },
        font: { color: '#1E293B', size: isHub ? 14 : (isStart ? 14 : 13) },
        borderWidth: isHub ? 3 : (isStart ? 2.5 : (hasLinks ? 2 : 1.5)),
        widthConstraint: { minimum: isHub ? 130 : 100, maximum: isHub ? 180 : 160 },
        shadow: isHub
          ? { enabled: true, size: 10, x: 0, y: 4, color: '#FF6B6B44' }
          : (isStart
            ? { enabled: true, size: 8, x: 0, y: 3, color: '#4CAF5044' }
            : (hasLinks
              ? { enabled: true, size: 6, x: 0, y: 3, color: color + '44' }
              : { enabled: true, size: 3, x: 0, y: 2, color: 'rgba(0,0,0,0.08)' })),
      };
    });

    const edges: any[] = [];
    activeModule.rows.forEach(row => {
      row.linked_row_ids.forEach(tid => {
        const meta  = getLinkMeta(row, tid);
        const color = lc(ci++);
        const sw    = STRENGTH.find(s => s.s === meta.s)?.width ?? 2.5;
        edges.push({
          id:     `${row.id}-${tid}`,
          from:   row.id,
          to:     tid,
          label:  meta.label || '',
          color:  { color, highlight: color, hover: color },
          width:  sw,
          dashes: meta.s === 1,
          font:   { size: 10, color: '#fff', background: color },
        });
      });
    });
    return { nodes, edges };
  };

  // Memoized — only rebuilds when module content changes, NOT when selection changes.
  // This prevents VisNetwork from reinitializing (and resetting zoom/pan) on every tap.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visData = useMemo(() => buildVisData(), [activeModule]);

  // ── AI ────────────────────────────────────────────────────────────────────

  const openAI = (mode: AIMode) => {
    setShowAIPanel(false);
    setAIPrompt('');
    if (mode === 'demo') { loadDemo(); return; }
    setAIMode(mode);
    if (mode === 'suggest') runAISuggestLinks();
    if (mode === 'fill') {
      setAIFillRows(activeModule?.rows.filter(r =>
        activeModule.column_definitions.some(c => !r.data[c.name]?.trim())
      ) ?? []);
    }
  };

  const runAIGenerateRows = async () => {
    if (!activeModule || !aiPrompt.trim()) return;
    setAILoading(true);
    try {
      const { data } = await modulesAPI.aiGenerateRows(activeModule.id, aiPrompt, aiRowCount);
      setAIMode(null); setAIPrompt('');
      const { data: mod } = await modulesAPI.get(activeModule.id);
      setActiveModule(mod);
      activeModuleRef.current = mod;
      Alert.alert('Done!', `${data.created} entries added by AI.`);
    } catch { Alert.alert('AI Error', 'Could not generate entries.'); }
    setAILoading(false);
  };

  const runAISuggestLinks = async () => {
    if (!activeModule) return;
    setAILoading(true);
    try {
      const { data } = await modulesAPI.aiSuggestLinks(activeModule.id);
      setAISuggestions(data.suggestions ?? []);
      setAISuggIdx(0);
      setAIMode('suggest');
    } catch { Alert.alert('AI Error', 'Could not analyze entries.'); setAIMode(null); }
    setAILoading(false);
  };

  const acceptSuggestion = async (s: LinkSuggestion) => {
    const fromRow = activeModule?.rows.find(r => r.id === s.from_row_id);
    if (fromRow) await toggleLink(fromRow, s.to_row_id);
    advanceSuggestion();
  };

  const advanceSuggestion = () => {
    if (aiSuggIdx + 1 >= aiSuggestions.length) { setAIMode(null); setAISuggestions([]); }
    else setAISuggIdx(i => i + 1);
  };

  const acceptAllSuggestions = async () => {
    if (!activeModule) return;
    setAILoading(true);
    let count = 0;
    for (const s of aiSuggestions) {
      const fromRow = activeModule.rows.find(r => r.id === s.from_row_id);
      if (fromRow && !fromRow.linked_row_ids.includes(s.to_row_id)) {
        await toggleLink(fromRow, s.to_row_id);
        count++;
      }
    }
    setAIMode(null);
    setAISuggestions([]);
    setAILoading(false);
    // Reload module so links are fresh
    if (activeModule) loadModule(activeModule.id);
    Alert.alert('Links Created!', `${count} connection${count !== 1 ? 's' : ''} added by AI.`);
  };

  const runAIFillRow = async (row: Row) => {
    if (!activeModule || fillingRowIds.has(row.id)) return;
    setFillingRowIds(prev => new Set(prev).add(row.id));
    try {
      const { data } = await modulesAPI.aiFillRow(activeModule.id, row.id);
      // Backend may return { data: {...} } or { row: { data: {...} } } — handle both
      const filled: Record<string, string> = data?.data ?? data?.row?.data ?? data ?? {};
      if (Object.keys(filled).length === 0) {
        Alert.alert('Nothing to fill', 'AI could not find data for this entry. Try adding more context to other rows first.');
        return;
      }
      setActiveModule(prev => prev ? {
        ...prev, rows: prev.rows.map(r => r.id === row.id ? { ...r, data: { ...r.data, ...filled } } : r),
      } : prev);
      setAIFillRows(prev => prev.filter(r => r.id !== row.id));
    } catch (e: any) {
      Alert.alert('AI Error', e?.response?.data?.detail ?? 'Could not fill this entry. Make sure the backend AI is running.');
    }
    setFillingRowIds(prev => { const s = new Set(prev); s.delete(row.id); return s; });
  };

  const runAIFillAll = async () => {
    if (!activeModule || aiFillRows.length === 0) return;
    setAILoading(true);
    let filled = 0;
    for (const row of aiFillRows) {
      try {
        const { data } = await modulesAPI.aiFillRow(activeModule.id, row.id);
        const filledData: Record<string, string> = data?.data ?? data?.row?.data ?? data ?? {};
        if (Object.keys(filledData).length > 0) {
          setActiveModule(prev => prev ? {
            ...prev, rows: prev.rows.map(r => r.id === row.id ? { ...r, data: { ...r.data, ...filledData } } : r),
          } : prev);
          filled++;
        }
      } catch { /* skip individual failures */ }
    }
    setAIFillRows([]);
    setAILoading(false);
    if (filled > 0) Alert.alert('Done!', `AI filled ${filled} entr${filled === 1 ? 'y' : 'ies'}.`);
    else Alert.alert('Nothing filled', 'AI could not fill any entries. Add more content to give the AI context.');
  };

  // ── Demo seed ─────────────────────────────────────────────────────────────

  const loadDemo = async () => {
    setLoading(true);
    try {
      // ── Module 1: Solar System ──
      const { data: m1 } = await modulesAPI.create({
        name: 'Solar System',
        description: 'Planets of our solar system and their properties',
        column_definitions: [
          { name: 'Planet', type: 'text' },
          { name: 'Type', type: 'text' },
          { name: 'Key Fact', type: 'text' },
        ],
      });
      const planets = [
        { Planet: 'Earth',   Type: 'Terrestrial', 'Key Fact': 'Only known planet with life' },
        { Planet: 'Mars',    Type: 'Terrestrial', 'Key Fact': 'Target of many space missions' },
        { Planet: 'Jupiter', Type: 'Gas Giant',   'Key Fact': 'Largest planet, 79 moons' },
        { Planet: 'Saturn',  Type: 'Gas Giant',   'Key Fact': 'Famous for its ring system' },
      ];
      for (const data of planets) {
        await modulesAPI.addRow(m1.id, { data, linked_row_ids: [], linked_knowledge_ids: [] });
      }
      const { data: m1f } = await modulesAPI.get(m1.id);
      const [earth, mars, jupiter, saturn] = m1f.rows;
      // Earth → Mars  (both rocky / terrestrial)
      await modulesAPI.updateRow(m1.id, earth.id, { data: earth.data, linked_row_ids: [mars.id], linked_knowledge_ids: [] });
      // Mars → Jupiter  (inner → outer, rocky to gas transition)
      await modulesAPI.updateRow(m1.id, mars.id,  { data: mars.data,  linked_row_ids: [earth.id, jupiter.id], linked_knowledge_ids: [] });
      // Jupiter → Saturn  (both gas giants)
      await modulesAPI.updateRow(m1.id, jupiter.id, { data: jupiter.data, linked_row_ids: [saturn.id], linked_knowledge_ids: [] });

      // ── Module 2: Space Missions ──
      const { data: m2 } = await modulesAPI.create({
        name: 'Space Missions',
        description: 'Historic space exploration missions',
        column_definitions: [
          { name: 'Mission',     type: 'text' },
          { name: 'Year',        type: 'text' },
          { name: 'Achievement', type: 'text' },
        ],
      });
      const missions = [
        { Mission: 'Apollo 11',   Year: '1969', Achievement: 'First humans on the Moon' },
        { Mission: 'Mars Rover',  Year: '2004', Achievement: 'Explored Mars surface' },
        { Mission: 'Voyager 1',   Year: '1977', Achievement: 'Reached interstellar space' },
        { Mission: 'James Webb',  Year: '2021', Achievement: 'Deepest images of the universe' },
      ];
      for (const data of missions) {
        await modulesAPI.addRow(m2.id, { data, linked_row_ids: [], linked_knowledge_ids: [] });
      }
      const { data: m2f } = await modulesAPI.get(m2.id);
      const [apollo, rover, voyager, webb] = m2f.rows;
      // Apollo → Mars Rover  (planetary surface exploration chain)
      await modulesAPI.updateRow(m2.id, apollo.id,  { data: apollo.data,  linked_row_ids: [rover.id],  linked_knowledge_ids: [] });
      // Voyager → James Webb  (deep-space observation chain)
      await modulesAPI.updateRow(m2.id, voyager.id, { data: voyager.data, linked_row_ids: [webb.id],   linked_knowledge_ids: [] });
      // Mars Rover → Voyager  (cross-chain: both leave Earth atmosphere)
      await modulesAPI.updateRow(m2.id, rover.id,   { data: rover.data,   linked_row_ids: [voyager.id], linked_knowledge_ids: [] });

      await loadModules();
      loadModule(m1.id);
      setViewMode('graph');
      Alert.alert(
        'Demo Ready!',
        'Two modules created with cross-links.\n\n' +
        '• Solar System: Earth→Mars→Jupiter→Saturn\n' +
        '• Space Missions: Apollo→Rover→Voyager→Webb\n\n' +
        'Tap a node, then tap another to add more links.',
      );
    } catch {
      Alert.alert('Error', 'Could not create demo. Is the backend running?');
    }
    setLoading(false);
  };

  const runAICreateModule = async () => {
    if (!aiPrompt.trim()) return;
    setAILoading(true);
    try {
      const { data } = await modulesAPI.aiCreate(aiPrompt);
      setAIMode(null); setAIPrompt('');
      await loadModules();
      loadModule(data.id);
      Alert.alert('Created!', `"${data.name}" is ready.`);
    } catch { Alert.alert('AI Error', 'Could not create module.'); }
    setAILoading(false);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safe}>

      {/* Header */}
      <AppHeader
        leftActions={[
          { icon: 'search-outline', onPress: () => router.navigate('/(tabs)'), color: Colors.textMuted },
          { icon: 'settings-outline', onPress: () => router.navigate('/(tabs)/settings'), color: Colors.textMuted },
          { icon: 'library-outline', onPress: () => router.navigate('/(tabs)/knowledge'), color: Colors.textMuted },
          { icon: 'book', color: Colors.primary, active: true },
        ]}
        rightActions={[
          { icon: 'folder-open-outline' as any, onPress: () => router.push('/files'), color: Colors.textMuted },
          { icon: 'earth-outline' as any, onPress: () => router.push('/graph?mode=global'), color: Colors.textMuted },
          ...(activeModule ? [{
            icon: 'git-network-outline' as any,
            onPress: () => router.push(`/graph?moduleId=${activeModule.id}`),
            color: Colors.textMuted,
          }] : []),
          { icon: 'add-circle-outline', onPress: () => setShowNewModule(true) },
        ]}
      />

      {/* ── Module selector ── */}
      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={styles.moduleBar}
        contentContainerStyle={styles.moduleBarContent}
      >
        {modules.map((m, mi) => {
          const isActive = activeModule?.id === m.id;
          const color = MODULE_COLORS[mi % MODULE_COLORS.length];
          const mod = isActive ? activeModule : null;
          const linkCount = mod ? mod.rows.reduce((s, r) => s + r.linked_row_ids.length, 0) : 0;
          return (
            <TouchableOpacity
              key={m.id}
              style={[styles.moduleCard, isActive && { borderColor: color, borderWidth: 2 }]}
              onPress={() => loadModule(m.id)}
              onLongPress={() => deleteModule(m.id)}
              activeOpacity={0.8}
            >
              <View style={[styles.moduleCardAccent, { backgroundColor: color }]} />
              <View style={styles.moduleCardBody}>
                <Text style={[styles.moduleCardName, isActive && { color }]} numberOfLines={1}>{m.name}</Text>
                {isActive && mod && (
                  <View style={styles.moduleCardStats}>
                    <Text style={styles.moduleCardStat}>{mod.rows.length} nodes</Text>
                    <Text style={styles.moduleCardStatDot}>·</Text>
                    <Text style={styles.moduleCardStat}>{linkCount} links</Text>
                  </View>
                )}
              </View>
              {isActive && <View style={[styles.moduleCardDot, { backgroundColor: color }]} />}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.moduleCardAdd} onPress={() => setShowNewModule(true)}>
          <Ionicons name="add" size={18} color={Colors.primary} />
          <Text style={styles.moduleCardAddTxt}>New</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Module description ── */}
      {activeModule?.description ? (
        <View style={styles.moduleDescBar}>
          <Ionicons name="information-circle-outline" size={13} color={Colors.textMuted} />
          <Text style={styles.moduleDescTxt} numberOfLines={2}>{activeModule.description}</Text>
        </View>
      ) : null}

      {/* ── Stats + view toggle bar ── */}
      {activeModule && (
        <View style={styles.statsBar}>
          <Ionicons name="git-network-outline" size={13} color={Colors.textMuted} />
          <Text style={styles.statsTxt}>
            <Text style={{ fontWeight: '700', color: Colors.textPrimary }}>{activeModule.rows.length}</Text> nodes
            {'  ·  '}
            <Text style={{ fontWeight: '700', color: Colors.textPrimary }}>
              {activeModule.rows.reduce((s, r) => s + r.linked_row_ids.length, 0)}
            </Text> links
          </Text>
          <TouchableOpacity style={styles.analyticsBtn} onPress={() => setShowAnalytics(true)}>
            <Ionicons name="bar-chart-outline" size={15} color={Colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.exportBtn} onPress={() => setShowExport(true)}>
            <Ionicons name="download-outline" size={15} color={Colors.success} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveModuleBtn} onPress={openSaveModule}>
            <Ionicons name="cloud-upload-outline" size={15} color="#7B1FA2" />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.toggleBtn, viewMode === 'list' && styles.toggleBtnActive]}
              onPress={() => setViewMode('list')}
            >
              <Ionicons name="list-outline" size={14} color={viewMode === 'list' ? Colors.white : Colors.textMuted} />
              <Text style={[styles.toggleTxt, viewMode === 'list' && styles.toggleTxtActive]}>List</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, viewMode === 'graph' && styles.toggleBtnActive]}
              onPress={() => setViewMode('graph')}
            >
              <Ionicons name="git-network-outline" size={14} color={viewMode === 'graph' ? Colors.white : Colors.textMuted} />
              <Text style={[styles.toggleTxt, viewMode === 'graph' && styles.toggleTxtActive]}>Graph</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Content ── */}
      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.primary} /></View>

      ) : !activeModule ? (
        /* Welcome */
        <ScrollView contentContainerStyle={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="git-network-outline" size={40} color={Colors.white} />
          </View>
          <Text style={styles.emptyTitle}>Learning Mode</Text>
          <Text style={styles.emptySub}>
            Build structured knowledge — add entries, draw connections, and let AI find the links.
          </Text>
          <View style={styles.guideBox}>
            {[
              ['add-circle-outline', 'Create a Module  (e.g. "Book Notes", "Spanish Verbs")'],
              ['pencil-outline', 'Add entries and fill in your data'],
              ['link-outline', 'Tap a node → tap another → link is drawn'],
              ['git-network-outline', 'Switch to Graph view to see all connections'],
              ['flash-outline', 'Use AI to generate entries, suggest links, or build a full module'],
            ].map(([icon, text], i) => (
              <View key={i} style={styles.guideRow}>
                <View style={styles.guideNum}><Text style={styles.guideNumTxt}>{i + 1}</Text></View>
                <Ionicons name={icon as any} size={14} color={Colors.primary} style={{ marginTop: 1 }} />
                <Text style={styles.guideTxt}>{text}</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setShowNewModule(true)}>
              <Ionicons name="add" size={16} color={Colors.white} />
              <Text style={styles.primaryBtnTxt}>New Module</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.aiBtn2} onPress={() => setAIMode('create')}>
              <Ionicons name="flash-outline" size={16} color={Colors.white} />
              <Text style={styles.primaryBtnTxt}>AI Create</Text>
            </TouchableOpacity>
          </View>

          {/* Demo seed */}
          <TouchableOpacity style={styles.demoBtn} onPress={loadDemo}>
            <Ionicons name="planet-outline" size={15} color={Colors.primary} />
            <Text style={styles.demoBtnTxt}>Try Demo — see linking in action</Text>
            <Ionicons name="arrow-forward" size={13} color={Colors.primary} />
          </TouchableOpacity>
        </ScrollView>

      ) : viewMode === 'list' ? (
        /* ══════════════ LIST VIEW ══════════════ */
        <View style={{ flex: 1 }}>
          {/* Row search bar */}
          <View style={styles.rowSearchBar}>
            <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
            <TextInput
              style={styles.rowSearchInput}
              placeholder="Search entries…"
              value={rowSearch}
              onChangeText={setRowSearch}
              placeholderTextColor={Colors.textMuted}
            />
            {rowSearch ? (
              <TouchableOpacity onPress={() => setRowSearch('')} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>
          <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 80, gap: 10 }}>

            {/* Link hint */}
            <View style={styles.hintBar}>
              <Ionicons name="information-circle-outline" size={13} color={Colors.primary} />
              <Text style={styles.hintTxt}>
                Tap <Text style={{ fontWeight: '700' }}>🔗</Text> on a card to draw a link.
                Switch to <Text style={{ fontWeight: '700' }}>Graph</Text> view to see all connections.
              </Text>
            </View>

            {activeModule.rows.length === 0 && (
              <View style={styles.emptyRows}>
                <Text style={styles.emptyRowsTxt}>No entries yet — tap Add below.</Text>
              </View>
            )}

            {activeModule.rows
              .filter(row => {
                if (!rowSearch.trim()) return true;
                const q = rowSearch.toLowerCase();
                return Object.values(row.data).some(v =>
                  typeof v === 'string' && v.toLowerCase().includes(q)
                );
              })
              .map((row) => {
              const hasLinks = row.linked_row_ids.length > 0;
              const rowImage = row.data['__image__'];
              const linkedRows = row.linked_row_ids
                .map(tid => activeModule.rows.find(r => r.id === tid))
                .filter(Boolean) as Row[];
              return (
                <View key={row.id} style={[styles.card, hasLinks && styles.cardLinked]}>
                  {/* Card header */}
                  <View style={styles.cardHeader}>
                    <View style={styles.cardNum}>
                      <Text style={styles.cardNumTxt}>{row.position + 1}</Text>
                    </View>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {rowLabel(row)}
                    </Text>
                    <TouchableOpacity
                      style={[styles.linkPill, hasLinks && styles.linkPillActive]}
                      onPress={() => { setLinkSourceRow(row); setShowLinkPicker(true); }}
                    >
                      <Ionicons name={hasLinks ? 'link' : 'link-outline'} size={13}
                        color={hasLinks ? Colors.white : Colors.primary} />
                      {hasLinks && <Text style={styles.linkCount}>{row.linked_row_ids.length}</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.crossLinkBtn} onPress={() => openCrossLink(row)}>
                      <Ionicons name="git-network-outline" size={12} color="#E91E63" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.editIcon}
                      onPress={() => pickRowImage(row)}
                      disabled={pickingImageRow === row.id}
                    >
                      {pickingImageRow === row.id
                        ? <ActivityIndicator size="small" color={Colors.textMuted} />
                        : <Ionicons name={rowImage ? 'image' : 'image-outline'} size={15} color={rowImage ? Colors.primary : Colors.textMuted} />
                      }
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.editIcon} onPress={() => openEditRow(row)}>
                      <Ionicons name="pencil-outline" size={15} color={Colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteRow(row.id)}>
                      <Ionicons name="trash-outline" size={15} color={Colors.error} />
                    </TouchableOpacity>
                  </View>

                  {/* Row image thumbnail */}
                  {rowImage ? (
                    <Image
                      source={{ uri: rowImage }}
                      style={styles.rowImage}
                      resizeMode="cover"
                    />
                  ) : null}

                  {/* Fields */}
                  <View style={styles.cardFields}>
                    {activeModule.column_definitions.slice(0, 3).map(col => (
                      <View key={col.name} style={styles.fieldRow}>
                        <Text style={styles.fieldKey}>{col.name}</Text>
                        <Text style={styles.fieldVal} numberOfLines={2}>
                          {row.data[col.name] || '—'}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* Link chips */}
                  {hasLinks && (
                    <View style={styles.chipRow}>
                      {linkedRows.map((tr, li) => {
                        const lbl = getLinkLabel(row, tr.id);
                        return (
                          <View key={tr.id} style={[styles.chip, { borderColor: lc(li) }]}>
                            <View style={[styles.chipDot, { backgroundColor: lc(li) }]} />
                            {lbl ? (
                              <Text style={[styles.chipLabel, { color: lc(li) }]}>{lbl}</Text>
                            ) : null}
                            <Ionicons name="arrow-forward" size={10} color={lc(li)} />
                            <Text style={[styles.chipTxt, { color: lc(li) }]} numberOfLines={1}>
                              {rowLabel(tr)}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                  {/* Cross-module link chips */}
                  {getCrossLinks(row).length > 0 && (
                    <View style={[styles.chipRow, { marginTop: 2 }]}>
                      <Ionicons name="git-network-outline" size={11} color="#E91E63" />
                      {getCrossLinks(row).map((xl, xi) => {
                        const modName = modules.find(m => m.id === xl.mid)?.name ?? 'Module';
                        return (
                          <TouchableOpacity
                            key={xi}
                            style={[styles.chip, { borderColor: '#E91E63' }]}
                            onLongPress={() => removeCrossLink(row, xl.mid, xl.rid)}
                          >
                            <Text style={[styles.chipLabel, { color: '#E91E63' }]}>{xl.label}</Text>
                            <Ionicons name="arrow-forward" size={10} color="#E91E63" />
                            <Text style={[styles.chipTxt, { color: '#E91E63' }]} numberOfLines={1}>
                              {modName}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>

          {/* Bottom bar */}
          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.addRowBtn} onPress={addRow}>
              <Ionicons name="add-circle-outline" size={17} color={Colors.primary} />
              <Text style={styles.addRowTxt}>Add Entry</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addColBtn2} onPress={() => setShowAddCol(true)}>
              <Ionicons name="git-branch-outline" size={15} color={Colors.textMuted} />
              <Text style={styles.addColTxt}>+ Field</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.aiBtn} onPress={() => setShowAIPanel(true)}>
              <Ionicons name="flash-outline" size={15} color={Colors.white} />
              <Text style={styles.aiBtnTxt}>AI</Text>
            </TouchableOpacity>
          </View>
        </View>

      ) : (
        /* ══════════════ GRAPH VIEW — vis-network ══════════════ */
        <View style={{ flex: 1 }}>
          {/* Hint bar */}
          {graphLinkMode ? (
            <View style={[styles.hintBar, styles.hintBarActive]}>
              <Ionicons name="radio-button-on" size={13} color={Colors.white} />
              <Text style={[styles.hintTxt, { color: Colors.white }]}>
                Tap a node to connect from <Text style={{ fontWeight: '900' }}>
                  {activeModule?.rows.find(r => r.id === graphSelected) ? rowLabel(activeModule.rows.find(r => r.id === graphSelected)!) : '?'}
                </Text> — or tap canvas to cancel
              </Text>
            </View>
          ) : (
            <View style={styles.hintBar}>
              <Ionicons name="hand-left-outline" size={13} color={Colors.primary} />
              <Text style={styles.hintTxt}>
                <Text style={{ fontWeight: '700' }}>Tap node</Text> for details.{'  '}
                <Text style={{ fontWeight: '700' }}>Drag</Text> to pan.{'  '}
                <Text style={{ fontWeight: '700' }}>Pinch</Text> to zoom.
              </Text>
            </View>
          )}

          {/* vis-network canvas */}
          <VisNetwork
            ref={visRef}
            data={visData}
            options={VIS_OPTIONS}
            style={{ flex: 1, backgroundColor: '#F4F8FF' }}
            onLoad={setupVisEvents}
          />

          {/* Node info panel — shown when a node is selected */}
          {graphSelected !== null && !graphLinkMode && (() => {
            const selRow = activeModule?.rows.find(r => r.id === graphSelected);
            if (!selRow) return null;
            const outgoing = selRow.linked_row_ids
              .map(tid => ({ row: activeModule!.rows.find(r => r.id === tid), label: getLinkLabel(selRow, tid) }))
              .filter(x => x.row) as { row: Row; label: string }[];
            const incoming = (activeModule?.rows ?? [])
              .filter(r => r.linked_row_ids.includes(graphSelected))
              .map(r => ({ row: r, label: getLinkLabel(r, graphSelected) }));
            return (
              <View style={styles.nodeInfoPanel}>
                <View style={styles.nodeInfoHeader}>
                  <Text style={styles.nodeInfoTitle} numberOfLines={1}>{rowLabel(selRow)}</Text>
                  <TouchableOpacity
                    style={styles.nodeConnectBtn}
                    onPress={() => setGraphLinkMode(true)}
                  >
                    <Ionicons name="link-outline" size={13} color={Colors.white} />
                    <Text style={styles.nodeConnectTxt}>Connect</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => {
                    setGraphSelected(null);
                    // Sync vis-network's internal selection state so next tap
                    // fires selectNode (not deselectNode), avoiding the stuck-panel bug.
                    visRef.current?.unselectAll();
                  }}>
                    <Ionicons name="close" size={18} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
                {(outgoing.length > 0 || incoming.length > 0) ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.nodeInfoConnRow}>
                    {outgoing.map(({ row: tr, label: lbl }, i) => (
                      <View key={`out${i}`} style={styles.nodeInfoChip}>
                        <Ionicons name="arrow-forward" size={10} color={Colors.primary} />
                        <Text style={styles.nodeInfoChipTxt} numberOfLines={1}>{rowLabel(tr)}</Text>
                        {lbl ? <Text style={styles.nodeInfoChipLbl}>{lbl}</Text> : null}
                      </View>
                    ))}
                    {incoming.map(({ row: ir, label: lbl }, i) => (
                      <View key={`in${i}`} style={[styles.nodeInfoChip, { borderColor: Colors.textMuted }]}>
                        <Ionicons name="arrow-back" size={10} color={Colors.textMuted} />
                        <Text style={[styles.nodeInfoChipTxt, { color: Colors.textMuted }]} numberOfLines={1}>{rowLabel(ir)}</Text>
                        {lbl ? <Text style={styles.nodeInfoChipLbl}>{lbl}</Text> : null}
                      </View>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.nodeInfoEmpty}>No connections yet — tap Connect to link</Text>
                )}
              </View>
            );
          })()}

          {/* Bottom bar */}
          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.addRowBtn} onPress={addRow}>
              <Ionicons name="add-circle-outline" size={17} color={Colors.primary} />
              <Text style={styles.addRowTxt}>Add Node</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.autoLayoutBtn}
              onPress={() => { visRef.current?.fit(); setGraphSelected(null); setGraphLinkMode(false); setGraphScale(1); }}
            >
              <Ionicons name="scan-outline" size={15} color={Colors.textMuted} />
              <Text style={styles.addColTxt}>Fit</Text>
            </TouchableOpacity>
            {/* Zoom controls — replaces disabled pinch-zoom */}
            <View style={styles.zoomGroup}>
              <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}>
                <Ionicons name="add" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}>
                <Ionicons name="remove" size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.aiBtn} onPress={() => setShowAIPanel(true)}>
              <Ionicons name="flash-outline" size={15} color={Colors.white} />
              <Text style={styles.aiBtnTxt}>AI</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ═══════════ MODALS ═══════════ */}

      {/* New Module */}
      <Modal visible={showNewModule} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>New Module</Text>
            <Text style={styles.sheetSub}>A module is a knowledge collection. Give it a clear name.</Text>
            <TextInput style={styles.input} placeholder="e.g. Spanish Verbs, Book Notes" value={newModName} onChangeText={setNewModName} placeholderTextColor={Colors.textMuted} autoFocus />
            <TextInput style={[styles.input, { height: 64 }]} placeholder="Description (optional)" value={newModDesc} onChangeText={setNewModDesc} multiline placeholderTextColor={Colors.textMuted} />
            <View style={styles.row2}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowNewModule(false)}><Text style={styles.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={createModule}><Text style={styles.confirmTxt}>Create</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Entry */}
      <Modal visible={showEditRow} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { maxHeight: '80%' }]}>
            <Text style={styles.sheetTitle}>Edit Entry</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {activeModule?.column_definitions.map(col => (
                <View key={col.name} style={{ marginBottom: 10 }}>
                  <Text style={styles.fieldKey}>{col.name}</Text>
                  <TextInput
                    style={[styles.input, { marginTop: 4 }]}
                    value={editData[col.name] || ''}
                    onChangeText={v => setEditData(prev => ({ ...prev, [col.name]: v }))}
                    placeholder={`Enter ${col.name}…`}
                    placeholderTextColor={Colors.textMuted}
                    multiline={col.type === 'text'}
                  />
                </View>
              ))}
            </ScrollView>
            <View style={styles.row2}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowEditRow(false)}><Text style={styles.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={saveEditRow}><Text style={styles.confirmTxt}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Field */}
      <Modal visible={showAddCol} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add Field</Text>
            <Text style={styles.sheetSub}>Add a new field to all entries (e.g. "Source", "Date", "Rating").</Text>
            <TextInput style={styles.input} placeholder="Field name" value={newColName} onChangeText={setNewColName} placeholderTextColor={Colors.textMuted} autoFocus />
            <View style={styles.row2}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddCol(false)}><Text style={styles.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={addColumn}><Text style={styles.confirmTxt}>Add</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Link Picker */}
      <Modal visible={showLinkPicker} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { maxHeight: '75%' }]}>
            <Text style={styles.sheetTitle}>Connect to…</Text>
            <View style={styles.fromBadge}>
              <Ionicons name="radio-button-on" size={12} color={Colors.primary} />
              <Text style={styles.fromBadgeTxt}>
                From: <Text style={{ fontWeight: '700' }}>{linkSourceRow ? rowLabel(linkSourceRow) : ''}</Text>
              </Text>
            </View>
            <Text style={styles.sheetSub}>Tap entries to toggle arrow connections.</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {activeModule?.rows.filter(r => r.id !== linkSourceRow?.id).map((row, li) => {
                const linked = linkSourceRow?.linked_row_ids.includes(row.id) ?? false;
                return (
                  <TouchableOpacity
                    key={row.id}
                    style={[styles.pickerRow, linked && styles.pickerRowActive]}
                    onPress={() => linkSourceRow && toggleLink(linkSourceRow, row.id)}
                  >
                    <View style={[styles.pickerDot, { backgroundColor: linked ? lc(li) : Colors.border }]} />
                    <Text style={[styles.pickerTxt, linked && { color: lc(li), fontWeight: '700' }]}>
                      {rowLabel(row)}
                    </Text>
                    {linked && <Ionicons name="checkmark-circle" size={18} color={lc(li)} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={[styles.confirmBtn, { marginTop: 10 }]} onPress={() => { setShowLinkPicker(false); setLinkSourceRow(null); }}>
              <Text style={styles.confirmTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AI Panel */}
      <Modal visible={showAIPanel} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.aiPanelHead}>
              <View style={styles.aiPanelIcon}><Ionicons name="flash-outline" size={18} color={Colors.white} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>AI Assistant</Text>
                <Text style={styles.sheetSub}>What would you like to do?</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAIPanel(false)}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            {([
              { mode: 'generate', icon: 'sparkles-outline', label: 'Generate Entries',  desc: 'Describe what entries you want — AI adds them', color: Colors.primary },
              { mode: 'suggest',  icon: 'link-outline',     label: 'Suggest Links',     desc: 'AI finds semantic connections between entries', color: '#00897B' },
              { mode: 'fill',     icon: 'create-outline',   label: 'Fill Empty Fields', desc: 'AI completes missing fields based on context', color: '#F57C00' },
              { mode: 'create',   icon: 'build-outline',    label: 'Create New Module', desc: 'Describe a topic — AI builds the whole module', color: '#E91E63' },
              { mode: 'demo',     icon: 'planet-outline',   label: 'Load Demo Data',    desc: 'Solar System + Space Missions with example links', color: '#5C6BC0' },
            ] as const).map(({ mode, icon, label, desc, color }) => (
              <TouchableOpacity key={mode} style={styles.aiOption} onPress={() => openAI(mode as AIMode)}>
                <View style={[styles.aiOptIcon, { backgroundColor: color + '22' }]}>
                  <Ionicons name={icon as any} size={19} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.aiOptLabel}>{label}</Text>
                  <Text style={styles.aiOptDesc}>{desc}</Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={Colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* AI Generate Entries */}
      <Modal visible={aiMode === 'generate'} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Generate Entries</Text>
            <Text style={styles.sheetSub}>Describe what entries you want for "{activeModule?.name}".</Text>
            <TextInput style={[styles.input, { height: 88 }]} placeholder={`e.g. "Top 5 causes of World War I"`} value={aiPrompt} onChangeText={setAIPrompt} multiline placeholderTextColor={Colors.textMuted} autoFocus />
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
              {AI_ROW_COUNTS.map(n => (
                <TouchableOpacity key={n} style={[styles.countChip, aiRowCount === n && styles.countChipActive]} onPress={() => setAIRowCount(n)}>
                  <Text style={[styles.countTxt, aiRowCount === n && styles.countTxtActive]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.row2}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAIMode(null)}><Text style={styles.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={runAIGenerateRows} disabled={aiLoading}>
                {aiLoading ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.confirmTxt}>Generate</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* AI Suggest Links */}
      <Modal visible={aiMode === 'suggest'} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            {aiLoading ? (
              <View style={{ alignItems: 'center', gap: 14, paddingVertical: 24 }}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.sheetTitle}>Analyzing your entries…</Text>
              </View>
            ) : aiSuggestions.length === 0 ? (
              <View style={{ alignItems: 'center', gap: 12, paddingVertical: 16 }}>
                <Ionicons name="checkmark-circle-outline" size={44} color={Colors.success} />
                <Text style={styles.sheetTitle}>No suggestions found</Text>
                <Text style={styles.sheetSub}>Add more entries with meaningful content.</Text>
                <TouchableOpacity style={styles.confirmBtn} onPress={() => setAIMode(null)}>
                  <Text style={styles.confirmTxt}>OK</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.sheetTitle}>Suggestion {aiSuggIdx + 1} / {aiSuggestions.length}</Text>
                {(() => {
                  const s = aiSuggestions[aiSuggIdx];
                  const from = activeModule?.rows.find(r => r.id === s.from_row_id);
                  const to   = activeModule?.rows.find(r => r.id === s.to_row_id);
                  return (
                    <View style={styles.suggCard}>
                      <View style={styles.suggArrow}>
                        <Text style={styles.suggNode} numberOfLines={1}>{from ? rowLabel(from) : `#${s.from_row_id}`}</Text>
                        <Ionicons name="arrow-forward" size={20} color={Colors.primary} />
                        <Text style={styles.suggNode} numberOfLines={1}>{to ? rowLabel(to) : `#${s.to_row_id}`}</Text>
                      </View>
                      <View style={styles.suggReason}>
                        <Ionicons name="sparkles-outline" size={12} color={Colors.primary} />
                        <Text style={styles.suggReasonTxt}>{s.reason}</Text>
                      </View>
                    </View>
                  );
                })()}
                <View style={styles.row2}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={advanceSuggestion}>
                    <Text style={styles.cancelTxt}>Skip</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtn, { backgroundColor: Colors.success }]}
                    onPress={() => acceptSuggestion(aiSuggestions[aiSuggIdx])}
                    disabled={aiLoading}
                  >
                    <Text style={styles.confirmTxt}>Accept</Text>
                  </TouchableOpacity>
                </View>
                {aiSuggestions.length > 1 && (
                  <TouchableOpacity
                    style={[styles.confirmBtn, { backgroundColor: '#7B1FA2', marginTop: 6 }]}
                    onPress={acceptAllSuggestions}
                    disabled={aiLoading}
                  >
                    {aiLoading
                      ? <ActivityIndicator size="small" color={Colors.white} />
                      : <Text style={styles.confirmTxt}>Accept All {aiSuggestions.length} Links</Text>}
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* AI Fill */}
      <Modal visible={aiMode === 'fill'} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { maxHeight: '75%' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Text style={[styles.sheetTitle, { flex: 1 }]}>Fill Empty Fields</Text>
              {aiFillRows.length > 1 && (
                <TouchableOpacity
                  style={[styles.confirmBtn, { paddingHorizontal: 12, paddingVertical: 6 }]}
                  onPress={runAIFillAll}
                  disabled={aiLoading}
                >
                  {aiLoading
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <Text style={styles.confirmTxt}>Fill All ({aiFillRows.length})</Text>}
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.sheetSub}>
              {aiFillRows.length === 0
                ? 'All entries are complete.'
                : `${aiFillRows.length} entr${aiFillRows.length === 1 ? 'y' : 'ies'} have empty fields — tap to fill individually or use Fill All.`}
            </Text>
            {aiFillRows.length === 0 ? (
              <View style={{ alignItems: 'center', gap: 10, paddingVertical: 16 }}>
                <Ionicons name="checkmark-done-circle-outline" size={40} color={Colors.success} />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 320 }}>
                {aiFillRows.map(row => {
                  const isFillingThis = fillingRowIds.has(row.id);
                  const missing = activeModule?.column_definitions
                    .filter(c => !c.name.startsWith('__') && !row.data[c.name]?.trim())
                    .map(c => c.name) ?? [];
                  return (
                    <TouchableOpacity
                      key={row.id}
                      style={[styles.fillRow, isFillingThis && { opacity: 0.6 }]}
                      onPress={() => runAIFillRow(row)}
                      disabled={isFillingThis || aiLoading}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fillLabel}>{rowLabel(row)}</Text>
                        <Text style={styles.fillMissing}>Missing: {missing.join(', ')}</Text>
                      </View>
                      {isFillingThis
                        ? <ActivityIndicator size="small" color={Colors.primary} />
                        : <View style={styles.fillBtn}>
                            <Ionicons name="flash-outline" size={12} color={Colors.white} />
                            <Text style={styles.fillBtnTxt}>Fill</Text>
                          </View>}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 8 }]} onPress={() => setAIMode(null)}>
              <Text style={[styles.cancelTxt, { textAlign: 'center' }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AI Create Module */}
      <Modal visible={aiMode === 'create'} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>AI Create Module</Text>
            <Text style={styles.sheetSub}>Describe a topic — AI builds a complete module with entries.</Text>
            <TextInput
              style={[styles.input, { height: 100 }]}
              placeholder={'e.g. "The planets of the solar system with diameter, distance and key features"'}
              value={aiPrompt} onChangeText={setAIPrompt} multiline
              placeholderTextColor={Colors.textMuted} autoFocus
            />
            <View style={styles.row2}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setAIMode(null); setAIPrompt(''); }}><Text style={styles.cancelTxt}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: '#E91E63' }]} onPress={runAICreateModule} disabled={aiLoading}>
                {aiLoading ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.confirmTxt}>Build Module</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Cross-module Link Modal ── */}
      <Modal visible={showCrossLink} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { maxHeight: '78%' }]}>
            <View style={styles.aiPanelHead}>
              <View style={[styles.aiPanelIcon, { backgroundColor: '#E91E63' }]}>
                <Ionicons name="git-network-outline" size={16} color={Colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>
                  {crossStep === 'module' ? 'Pick a Module' : 'Pick a Node'}
                </Text>
                <Text style={styles.sheetSub}>
                  {crossStep === 'module'
                    ? `Linking from: "${crossSource ? rowLabel(crossSource) : ''}"`
                    : `From "${crossSource ? rowLabel(crossSource) : ''}" → ${crossModFull?.name}`}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowCrossLink(false)}>
                <Ionicons name="close" size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            {crossStep === 'module' ? (
              <ScrollView style={{ maxHeight: 340 }}>
                {modules.filter(m => m.id !== activeModule?.id).map((m, mi) => (
                  <TouchableOpacity
                    key={m.id}
                    style={styles.pickerRow}
                    onPress={() => pickCrossModule(m)}
                  >
                    <View style={[styles.chipDot, { backgroundColor: MODULE_COLORS[mi % MODULE_COLORS.length], width: 10, height: 10, borderRadius: 5 }]} />
                    <Text style={styles.pickerTxt}>{m.name}</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                  </TouchableOpacity>
                ))}
                {modules.filter(m => m.id !== activeModule?.id).length === 0 && (
                  <Text style={[styles.sheetSub, { textAlign: 'center', padding: 20 }]}>
                    No other modules yet. Create another module first.
                  </Text>
                )}
              </ScrollView>
            ) : (
              <>
                <ScrollView style={{ maxHeight: 240 }}>
                  {crossModFull?.rows.map(row => (
                    <TouchableOpacity key={row.id} style={styles.pickerRow} onPress={() => addCrossLink(row)}>
                      <Text style={styles.pickerTxt}>{rowLabel(row)}</Text>
                      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {/* Label + strength for cross-link */}
                <View style={styles.presetGrid}>
                  {LABEL_PRESETS.slice(0, 4).map(p => (
                    <TouchableOpacity key={p} style={[styles.presetChip, crossLabel === p && styles.presetChipActive]} onPress={() => setCrossLabel(p)}>
                      <Text style={[styles.presetTxt, crossLabel === p && styles.presetTxtActive]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.strengthRow}>
                  {STRENGTH.map(({ s, label, icon, color }) => (
                    <TouchableOpacity key={s} style={[styles.strengthBtn, crossStrength === s && { borderColor: color, backgroundColor: color + '18' }]} onPress={() => setCrossStrength(s)}>
                      <Ionicons name={icon as any} size={14} color={crossStrength === s ? color : Colors.textMuted} />
                      <Text style={[styles.strengthTxt, crossStrength === s && { color }]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setCrossStep('module')}>
                  <Text style={styles.cancelTxt}>← Back</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Analytics Modal ── */}
      <Modal visible={showAnalytics} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { maxHeight: '85%' }]}>
            <View style={styles.aiPanelHead}>
              <View style={[styles.aiPanelIcon, { backgroundColor: '#43A047' }]}>
                <Ionicons name="bar-chart-outline" size={16} color={Colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Graph Analytics</Text>
                <Text style={styles.sheetSub}>{activeModule?.name}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAnalytics(false)}>
                <Ionicons name="close" size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            {analytics && (
              <>
                {/* Summary row */}
                <View style={styles.analyticsGrid}>
                  {[
                    { label: 'Nodes', value: activeModule?.rows.length ?? 0, icon: 'layers-outline', color: Colors.primary },
                    { label: 'Intra links', value: analytics.totalLinks, icon: 'link-outline', color: '#00897B' },
                    { label: 'Cross links', value: analytics.totalCross, icon: 'git-network-outline', color: '#E91E63' },
                    { label: 'Avg links', value: analytics.avg, icon: 'analytics-outline', color: '#F57C00' },
                  ].map(({ label, value, icon, color }) => (
                    <View key={label} style={[styles.analyticsCard, { borderColor: color + '40' }]}>
                      <Ionicons name={icon as any} size={18} color={color} />
                      <Text style={[styles.analyticsVal, { color }]}>{value}</Text>
                      <Text style={styles.analyticsLbl}>{label}</Text>
                    </View>
                  ))}
                </View>

                {/* Hub ranking */}
                <Text style={[styles.sheetTitle, { fontSize: 14, marginTop: 4 }]}>Knowledge Hubs</Text>
                <ScrollView style={{ maxHeight: 260 }}>
                  {analytics.counts.map(({ row: r, label: lbl, intra, cross, total }, i) => (
                    <View key={r.id} style={styles.hubRow}>
                      <View style={[styles.hubRank, { backgroundColor: i === 0 ? Colors.gold : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : Colors.border }]}>
                        <Text style={styles.hubRankTxt}>{i + 1}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.hubLabel} numberOfLines={1}>{lbl}</Text>
                        <Text style={styles.hubSub}>{intra} intra · {cross} cross</Text>
                      </View>
                      <View style={styles.hubBar}>
                        <View style={[styles.hubFill, { width: `${Math.min(100, (total / Math.max(1, analytics.counts[0].total)) * 100)}%`, backgroundColor: total > 0 ? Colors.primary : Colors.border }]} />
                      </View>
                      <Text style={styles.hubTotal}>{total}</Text>
                    </View>
                  ))}
                  {analytics.isolated.length > 0 && (
                    <View style={styles.isolatedBar}>
                      <Ionicons name="alert-circle-outline" size={13} color={Colors.textMuted} />
                      <Text style={styles.isolatedTxt}>
                        {analytics.isolated.length} isolated node{analytics.isolated.length > 1 ? 's' : ''} (no links yet)
                      </Text>
                    </View>
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Export Modal ── */}
      <Modal visible={showExport} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.aiPanelHead}>
              <View style={[styles.aiPanelIcon, { backgroundColor: Colors.success }]}>
                <Ionicons name="download-outline" size={18} color={Colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Export Module</Text>
                <Text style={styles.sheetSub}>{activeModule?.name} · {activeModule?.rows.length} entries</Text>
              </View>
              <TouchableOpacity onPress={() => setShowExport(false)}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.exportOption} onPress={() => { setShowExport(false); exportJSON(); }}>
              <View style={[styles.exportOptIcon, { backgroundColor: '#3B52CC22' }]}>
                <Ionicons name="code-outline" size={22} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.exportOptLabel}>Export as JSON</Text>
                <Text style={styles.exportOptDesc}>Full structure: columns, rows, link counts — machine-readable</Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={Colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.exportOption} onPress={() => { setShowExport(false); exportCSV(); }}>
              <View style={[styles.exportOptIcon, { backgroundColor: '#00897B22' }]}>
                <Ionicons name="grid-outline" size={22} color="#00897B" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.exportOptLabel}>Export as CSV</Text>
                <Text style={styles.exportOptDesc}>Flat spreadsheet format — open in Excel or Google Sheets</Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Save Module to Knowledge Library ── */}
      <Modal visible={showSaveModule} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={[styles.sheet, { maxHeight: '85%' }]}>
            <View style={styles.aiPanelHead}>
              <View style={[styles.aiPanelIcon, { backgroundColor: '#7B1FA2' }]}>
                <Ionicons name="cloud-upload-outline" size={18} color={Colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Save to Knowledge Library</Text>
                <Text style={styles.sheetSub} numberOfLines={1}>{activeModule?.name}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowSaveModule(false)}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Module preview */}
            {activeModule && (
              <View style={styles.savePreview}>
                <View style={styles.savePreviewRow}>
                  <Text style={styles.savePreviewKey}>Module</Text>
                  <Text style={styles.savePreviewVal}>{activeModule.name}</Text>
                </View>
                <View style={styles.savePreviewRow}>
                  <Text style={styles.savePreviewKey}>Entries</Text>
                  <Text style={styles.savePreviewVal}>{activeModule.rows.length} rows · {activeModule.column_definitions.filter(c => !c.name.startsWith('__')).length} columns</Text>
                </View>
                <View style={styles.savePreviewRow}>
                  <Text style={styles.savePreviewKey}>Links</Text>
                  <Text style={styles.savePreviewVal}>{activeModule.rows.reduce((s, r) => s + r.linked_row_ids.length, 0)} connections between entries</Text>
                </View>
                {activeModule.description ? (
                  <View style={styles.savePreviewRow}>
                    <Text style={styles.savePreviewKey}>About</Text>
                    <Text style={styles.savePreviewVal} numberOfLines={2}>{activeModule.description}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {/* Category */}
            <Text style={[styles.sheetSub, { marginBottom: 4 }]}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}
              contentContainerStyle={{ gap: 6 }}>
              {MODULE_CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.countChip, saveModuleCategory === cat && styles.countChipActive]}
                  onPress={() => setSaveModuleCategory(cat)}
                >
                  <Text style={[styles.countTxt, saveModuleCategory === cat && styles.countTxtActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Visibility toggle */}
            <View style={styles.visibilityRow}>
              <TouchableOpacity
                style={[styles.visBtn, !saveModulePublic && styles.visBtnActive]}
                onPress={() => setSaveModulePublic(false)}
              >
                <Ionicons name="lock-closed-outline" size={15} color={!saveModulePublic ? Colors.white : Colors.textMuted} />
                <Text style={[styles.visBtnTxt, !saveModulePublic && styles.visBtnTxtActive]}>Private</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.visBtn, saveModulePublic && { ...styles.visBtnActive, backgroundColor: '#7B1FA2' }]}
                onPress={() => setSaveModulePublic(true)}
              >
                <Ionicons name="globe-outline" size={15} color={saveModulePublic ? Colors.white : Colors.textMuted} />
                <Text style={[styles.visBtnTxt, saveModulePublic && styles.visBtnTxtActive]}>Public</Text>
              </TouchableOpacity>
            </View>

            {saveModulePublic && (
              <View style={styles.priceRow}>
                <Ionicons name="pricetag-outline" size={16} color="#7B1FA2" />
                <Text style={styles.priceLabel}>Price (USD) — 0 = free</Text>
                <TextInput
                  style={styles.priceInput}
                  value={saveModulePrice}
                  onChangeText={setSaveModulePrice}
                  keyboardType="numeric"
                  placeholder="0.00"
                  placeholderTextColor={Colors.textMuted}
                />
              </View>
            )}

            <Text style={styles.sheetSub}>
              {saveModulePublic
                ? `The entire module will be listed on the marketplace${parseFloat(saveModulePrice) > 0 ? ` for $${saveModulePrice}` : ' for free'}.`
                : 'The entire module will be saved to your private Knowledge Library.'}
            </Text>

            <View style={styles.row2}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSaveModule(false)}>
                <Text style={styles.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, { backgroundColor: '#7B1FA2' }]}
                onPress={confirmSaveModule}
                disabled={saveModuleLoading}
              >
                {saveModuleLoading
                  ? <ActivityIndicator size="small" color={Colors.white} />
                  : <Text style={styles.confirmTxt}>Save to Library</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Link Label Modal ── */}
      <Modal visible={showLabelModal} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.labelSheet}>
            {/* Header */}
            <View style={styles.labelHeader}>
              <View style={styles.labelHeaderIcon}>
                <Ionicons name="link" size={16} color={Colors.white} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Name this connection</Text>
                <Text style={styles.sheetSub}>What is the relationship between these two nodes?</Text>
              </View>
            </View>

            {/* Quick presets */}
            <View style={styles.presetGrid}>
              {LABEL_PRESETS.map(preset => (
                <TouchableOpacity
                  key={preset}
                  style={[styles.presetChip, newLabel === preset && styles.presetChipActive]}
                  onPress={() => setNewLabel(preset)}
                >
                  <Text style={[styles.presetTxt, newLabel === preset && styles.presetTxtActive]}>{preset}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Custom input */}
            <TextInput
              style={styles.labelInput}
              placeholder="Or type a custom label…"
              placeholderTextColor={Colors.textMuted}
              value={newLabel}
              onChangeText={setNewLabel}
              autoCapitalize="none"
            />

            {/* Strength selector */}
            <Text style={[styles.sheetSub, { marginBottom: 0 }]}>Connection strength</Text>
            <View style={styles.strengthRow}>
              {STRENGTH.map(({ s, label, icon, color, width }) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.strengthBtn, newStrength === s && { borderColor: color, backgroundColor: color + '18' }]}
                  onPress={() => setNewStrength(s)}
                >
                  <Ionicons name={icon as any} size={16} color={newStrength === s ? color : Colors.textMuted} />
                  <Text style={[styles.strengthTxt, newStrength === s && { color }]}>{label}</Text>
                  {/* Visual line preview */}
                  <View style={[styles.strengthLine, { height: width, backgroundColor: newStrength === s ? color : Colors.border,
                    borderStyle: s === 1 ? 'dashed' : 'solid' }]} />
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.row2}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => { setShowLabelModal(false); setPendingLink(null); setNewLabel(''); }}
              >
                <Text style={styles.cancelTxt}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { flexDirection: 'row', gap: 6 }]} onPress={confirmLabel}>
                <Ionicons name="checkmark" size={14} color={Colors.white} />
                <Text style={styles.confirmTxt}>Save Label</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  // ── Module selector bar ──
  moduleBar: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    maxHeight: 72,
  },
  moduleBarContent: { paddingHorizontal: 10, paddingVertical: 8, gap: 8, alignItems: 'center' },
  moduleCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.border,
    height: 52, overflow: 'hidden', minWidth: 110,
    ...Shadow.sm,
  },
  moduleCardAccent: { width: 4, alignSelf: 'stretch' },
  moduleCardBody: { flex: 1, paddingHorizontal: 10, paddingVertical: 6 },
  moduleCardName: { fontSize: 12, fontWeight: '700', color: Colors.textPrimary },
  moduleCardStats: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  moduleCardStat: { fontSize: 10, color: Colors.textMuted },
  moduleCardStatDot: { fontSize: 10, color: Colors.textMuted },
  moduleCardDot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 8 },
  moduleCardAdd: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.background, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.primary, borderStyle: 'dashed',
    height: 52, paddingHorizontal: 14,
  },
  moduleCardAddTxt: { fontSize: 12, color: Colors.primary, fontWeight: '600' },

  // ── Stats bar ──
  statsBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.background,
    paddingHorizontal: 14, paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  statsTxt: { fontSize: 12, color: Colors.textMuted },

  // ── View toggle ──
  viewToggle: { flexDirection: 'row', gap: 2 },
  toggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  toggleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  toggleTxt: { fontSize: 11, fontWeight: '600', color: Colors.textMuted },
  toggleTxtActive: { color: Colors.white },

  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // ── Empty / Welcome ──
  emptyWrap: { flexGrow: 1, alignItems: 'center', padding: 24, gap: 14, paddingBottom: 40 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3, shadowRadius: 16, elevation: 8,
  },
  emptyTitle: { fontSize: FontSizes.xl, fontWeight: '800', color: Colors.primary },
  emptySub: { fontSize: FontSizes.sm, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  guideBox: { backgroundColor: Colors.surface, borderRadius: Radius.md, padding: 16, gap: 10, width: '100%', ...Shadow.sm },
  guideRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  guideNum: { width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  guideNumTxt: { color: Colors.white, fontSize: 10, fontWeight: '800' },
  guideTxt: { flex: 1, fontSize: 12, color: Colors.textPrimary, lineHeight: 18 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, paddingHorizontal: 18, paddingVertical: 11, borderRadius: Radius.full },
  aiBtn2: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#E91E63', paddingHorizontal: 18, paddingVertical: 11, borderRadius: Radius.full },
  primaryBtnTxt: { color: Colors.white, fontWeight: '700', fontSize: FontSizes.base },
  demoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: Colors.primaryLight, borderStyle: 'dashed',
    borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 11,
    backgroundColor: '#F4F8FF',
  },
  demoBtnTxt: { flex: 1, fontSize: 13, color: Colors.primary, fontWeight: '600' },

  // ── Module description bar ──
  moduleDescBar: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    paddingHorizontal: 14, paddingVertical: 6,
    backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  moduleDescTxt: {
    flex: 1, fontSize: 11, color: Colors.textSecondary, lineHeight: 16,
  },

  // ── Row search bar ──
  rowSearchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 12, marginTop: 8, marginBottom: 2,
    backgroundColor: Colors.surface, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  rowSearchInput: { flex: 1, fontSize: FontSizes.sm, color: Colors.textPrimary },

  // ── Row image thumbnail ──
  rowImage: {
    width: '100%', height: 130, borderRadius: Radius.sm, marginBottom: 6,
  },

  // ── Hint bar ──
  hintBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EEF4FF', paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.primaryLight,
  },
  hintBarActive: { backgroundColor: Colors.primary },
  hintTxt: { flex: 1, fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },

  // ── List view cards ──
  emptyRows: { alignItems: 'center', padding: 32 },
  emptyRowsTxt: { color: Colors.textMuted, fontSize: FontSizes.sm },
  card: {
    backgroundColor: Colors.surface, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden', ...Shadow.sm,
  },
  cardLinked: { borderColor: Colors.primaryLight, borderWidth: 1.5 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  cardNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary + '20', justifyContent: 'center', alignItems: 'center',
  },
  cardNumTxt: { fontSize: 10, fontWeight: '800', color: Colors.primary },
  cardTitle: { flex: 1, fontSize: FontSizes.base, fontWeight: '700', color: Colors.textPrimary },
  linkPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.primaryLight,
    backgroundColor: Colors.white,
  },
  linkPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  linkCount: { fontSize: 10, color: Colors.white, fontWeight: '700' },
  editIcon: { padding: 2 },
  cardFields: { paddingHorizontal: 12, paddingBottom: 10, gap: 4 },
  fieldRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  fieldKey: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', width: 72, flexShrink: 0 },
  fieldVal: { flex: 1, fontSize: 12, color: Colors.textPrimary, lineHeight: 18 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.full, borderWidth: 1.5 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipLabel: { fontSize: 10, fontWeight: '700', fontStyle: 'italic' },
  chipTxt: { fontSize: 11, fontWeight: '600' },

  // ── Graph canvas nodes ──
  node: {
    position: 'absolute',
    width: 168,
    height: 90,
    borderRadius: 14,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 4,
  },
  nodeStrip: { width: 5, alignSelf: 'stretch' },
  nodeLinked: { borderColor: Colors.primaryLight, borderWidth: 1.5, elevation: 6 },
  nodeSelected: {
    borderColor: Colors.gold,
    borderWidth: 2,
    shadowColor: Colors.gold,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 12,
  },
  nodeTouchable: { flex: 1, padding: 10 },
  nodeHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 },
  nodeIndex: { fontSize: 10, fontWeight: '700', color: Colors.textMuted },
  nodeTitle: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginBottom: 3 },
  nodeLinkBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  nodeLinkCount: { fontSize: 10, fontWeight: '700' },
  nodeSelBadge: { backgroundColor: Colors.gold + '22', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  nodeSelTxt: { fontSize: 9, color: Colors.gold, fontWeight: '700' },
  nodeSub: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  canvasEmpty: { position: 'absolute', top: '28%', left: 0, right: 0, alignItems: 'center', gap: 12 },
  canvasEmptyTxt: { color: Colors.textMuted, fontSize: FontSizes.sm },

  // ── Bottom bar ──
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: 12, paddingVertical: 9,
    ...Shadow.sm,
  },
  addRowBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed',
    borderRadius: Radius.md, paddingVertical: 9, paddingHorizontal: 12,
  },
  addRowTxt: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  addColBtn2: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 9,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
  },
  addColTxt: { fontSize: 12, color: Colors.textMuted },
  autoLayoutBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 9,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
  },
  zoomGroup: {
    flexDirection: 'row', gap: 2,
  },
  zoomBtn: {
    width: 32, height: 32, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  aiBtnTxt: { color: Colors.white, fontWeight: '700', fontSize: 13 },

  // ── Modals ──
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 22, gap: 10 },
  sheetTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.textPrimary },
  sheetSub: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18, marginTop: -4 },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: 13, paddingVertical: 10,
    fontSize: FontSizes.base, color: Colors.textPrimary,
  },
  row2: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelTxt: { color: Colors.textSecondary, fontWeight: '600' },
  confirmBtn: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center' },
  confirmTxt: { color: Colors.white, fontWeight: '700' },

  fromBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EEF4FF', padding: 8, borderRadius: Radius.sm },
  fromBadgeTxt: { fontSize: 12, color: Colors.textSecondary },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  pickerRowActive: { backgroundColor: '#F4F8FF' },
  pickerDot: { width: 10, height: 10, borderRadius: 5 },
  pickerTxt: { flex: 1, fontSize: FontSizes.base, color: Colors.textPrimary },

  // AI Panel
  aiPanelHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  aiPanelIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  aiOption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  aiOptIcon: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  aiOptLabel: { fontSize: FontSizes.base, fontWeight: '700', color: Colors.textPrimary },
  aiOptDesc: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16, marginTop: 1 },

  suggCard: { backgroundColor: '#F4F8FF', borderRadius: Radius.md, padding: 14, gap: 10 },
  suggArrow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  suggNode: { flex: 1, fontWeight: '700', fontSize: FontSizes.base, color: Colors.textPrimary, textAlign: 'center' },
  suggReason: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  suggReasonTxt: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },

  countChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border },
  countChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  countTxt: { color: Colors.textSecondary, fontWeight: '600', fontSize: 13 },
  countTxtActive: { color: Colors.white },

  fillRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  fillLabel: { fontSize: FontSizes.base, fontWeight: '700', color: Colors.textPrimary },
  fillMissing: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  fillBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radius.sm },
  fillBtnTxt: { color: Colors.white, fontSize: 12, fontWeight: '700' },

  // ── Analytics button ──
  analyticsBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Export button ──
  exportBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.success + '18',
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Save to Knowledge button on card ──
  saveModuleBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#7B1FA218',
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Save preview card ──
  savePreview: {
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    padding: 10, gap: 6, marginBottom: 4,
  },
  savePreviewRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  savePreviewKey: {
    width: 80, fontSize: 11, fontWeight: '700',
    color: Colors.textMuted, flexShrink: 0, paddingTop: 1,
  },
  savePreviewVal: { flex: 1, fontSize: 12, color: Colors.textPrimary, lineHeight: 17 },

  // ── Export modal ──
  exportOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  exportOptIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  exportOptLabel: { fontSize: FontSizes.base, fontWeight: '700', color: Colors.textPrimary },
  exportOptDesc: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16, marginTop: 2 },

  // ── Save to Knowledge modal ──
  visibilityRow: { flexDirection: 'row', gap: 10 },
  visBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 11, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  visBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  visBtnTxt: { fontSize: 13, fontWeight: '700', color: Colors.textMuted },
  visBtnTxtActive: { color: Colors.white },
  priceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.success + '12',
    borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10,
  },
  priceLabel: { flex: 1, fontSize: 13, color: Colors.textSecondary },
  priceInput: {
    width: 72, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.sm,
    paddingHorizontal: 10, paddingVertical: 6,
    fontSize: FontSizes.base, color: Colors.textPrimary, textAlign: 'right',
  },

  // ── Cross-link button on card ──
  crossLinkBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#FFF0F5', borderWidth: 1, borderColor: '#E91E63',
    justifyContent: 'center', alignItems: 'center',
  },

  // ── Node cross badge ──
  nodeCrossBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#FFF0F5', paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: 7, alignSelf: 'flex-start', marginTop: 3,
  },
  nodeCrossTxt: { fontSize: 9, color: '#E91E63', fontWeight: '700' },

  // ── Link label modal ──
  labelSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 22, gap: 14,
    // centre vertically on smaller sheets
    marginTop: 'auto',
  },
  labelHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  labelHeaderIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  presetChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  presetTxt: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },
  presetTxtActive: { color: Colors.white },
  labelInput: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: 13, paddingVertical: 10,
    fontSize: FontSizes.base, color: Colors.textPrimary,
  },

  // ── Strength selector ──
  strengthRow: { flexDirection: 'row', gap: 8 },
  strengthBtn: {
    flex: 1, alignItems: 'center', gap: 5, paddingVertical: 10,
    borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  strengthTxt: { fontSize: 11, fontWeight: '700', color: Colors.textMuted },
  strengthLine: { width: '70%', borderRadius: 2 },

  // ── Analytics modal ──
  analyticsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 4 },
  analyticsCard: {
    flex: 1, minWidth: '42%', alignItems: 'center', gap: 4,
    backgroundColor: Colors.background, borderRadius: Radius.md,
    borderWidth: 1, padding: 12,
  },
  analyticsVal: { fontSize: 22, fontWeight: '800' },
  analyticsLbl: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', textAlign: 'center' },

  // ── Hub ranking rows ──
  hubRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  hubRank: {
    width: 24, height: 24, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  hubRankTxt: { fontSize: 11, fontWeight: '800', color: Colors.white },
  hubLabel: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary },
  hubSub: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  hubBar: { width: 64, height: 6, borderRadius: 3, backgroundColor: Colors.border, overflow: 'hidden' },
  hubFill: { height: 6, borderRadius: 3 },
  hubTotal: { fontSize: 13, fontWeight: '800', color: Colors.textPrimary, minWidth: 20, textAlign: 'right' },

  // ── Isolated nodes warning ──
  isolatedBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFF8E1', borderRadius: Radius.sm,
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 8,
  },
  isolatedTxt: { fontSize: 12, color: Colors.textMuted, flex: 1 },

  // ── Node info panel (graph view) ──
  nodeInfoPanel: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.primaryLight,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    ...Shadow.sm,
  },
  nodeInfoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nodeInfoTitle: { flex: 1, fontSize: 13, fontWeight: '800', color: Colors.textPrimary },
  nodeConnectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full,
  },
  nodeConnectTxt: { fontSize: 11, color: Colors.white, fontWeight: '700' },
  nodeInfoConnRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  nodeInfoChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1.5, borderColor: Colors.primary,
    borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4,
    backgroundColor: '#EEF4FF',
  },
  nodeInfoChipTxt: { fontSize: 11, fontWeight: '600', color: Colors.primary, maxWidth: 100 },
  nodeInfoChipLbl: { fontSize: 10, color: Colors.textMuted, fontStyle: 'italic' },
  nodeInfoEmpty: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', paddingVertical: 4 },
});
