/**
 * Knowledge Graph — Obsidian-like force-directed node/edge map.
 *
 * Modes:
 *  • Global mode  — all knowledge items as nodes, knowledge links as edges
 *  • Module mode  — module rows as nodes, linked_row_ids as directed edges
 *
 * Features:
 *  • Force-directed layout (Verlet integration, 100 iterations at load)
 *  • Curved bezier edges with arrowheads (SVG Marker)
 *  • PanResponder for pan + hit-test tap (no ScrollView → no Android touch bug)
 *  • Tap node → bottom sheet with connections + AI suggest links
 *  • Categories/modules get distinct colors
 *  • Live re-layout on refresh
 *  • Backlinks shown in detail sheet
 */
import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Dimensions, PanResponder, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Text as SvgText, G, Defs, Marker, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Colors, FontSizes } from '../constants/theme';
import { knowledgeAPI, modulesAPI } from '../services/api';

const { width: SW, height: SH } = Dimensions.get('window');
// Canvas slightly larger than screen — nodes placed at centre so view opens there
const CANVAS_W = SW  * 1.6;
const CANVAS_H = SH  * 1.6;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;
// ScrollView initial offset to show the node cluster at canvas centre
const INIT_OFFSET_X = (CANVAS_W - SW)  / 2;
const INIT_OFFSET_Y = (CANVAS_H - SH)  / 2;
const NODE_R = 22;
const PANEL_W = 240; // Width of the animated overlay right panel

// ── Colors ───────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Technology: '#3B52CC',
  Science:    '#00897B',
  History:    '#8D6E63',
  Personal:   '#E91E63',
  Health:     '#43A047',
  Business:   '#F57C00',
  General:    '#5C6BC0',
  Language:   '#7B1FA2',
  Math:       '#0288D1',
  Art:        '#C62828',
};

const MODULE_ROW_COLORS = [
  '#3B52CC', '#00897B', '#E91E63', '#F57C00',
  '#7B1FA2', '#0288D1', '#43A047', '#8D6E63',
];

function categoryColor(cat: string) {
  return CATEGORY_COLORS[cat] ?? Colors.primary;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface KNode {
  id: number;
  title: string;
  category: string;
  summary: string;
  x: number;
  y: number;
}

interface KEdge {
  source: number;
  target: number;
  label: string;
  directed?: boolean;
}

// ── Force-directed layout ────────────────────────────────────────────────────

function circleLayout(items: { id: number; title: string; category: string; summary: string }[]): KNode[] {
  const r = Math.min(CX, CY) * 0.55;
  return items.map((item, i) => {
    const angle = (2 * Math.PI * i) / Math.max(items.length, 1) - Math.PI / 2;
    // Add slight random jitter so force simulation doesn't start perfectly symmetric
    const jitter = () => (Math.random() - 0.5) * 40;
    return {
      ...item,
      x: CX + r * Math.cos(angle) + jitter(),
      y: CY + r * Math.sin(angle) + jitter(),
    };
  });
}

function forceLayout(initial: KNode[], edges: KEdge[]): KNode[] {
  let nodes = initial.map(n => ({ ...n }));
  const REPULSION = 5000;
  const SPRING_LEN = 140;
  const SPRING_K = 0.12;
  const GRAVITY = 0.04;
  const ITERS = 120;

  for (let iter = 0; iter < ITERS; iter++) {
    const fx: Record<number, number> = {};
    const fy: Record<number, number> = {};
    nodes.forEach(n => { fx[n.id] = 0; fy[n.id] = 0; });

    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = b.x - a.x || 0.01;
        const dy = b.y - a.y || 0.01;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = REPULSION / (dist * dist);
        fx[a.id] -= (f * dx) / dist;
        fy[a.id] -= (f * dy) / dist;
        fx[b.id] += (f * dx) / dist;
        fy[b.id] += (f * dy) / dist;
      }
    }

    // Spring attraction along edges
    edges.forEach(e => {
      const src = nodes.find(n => n.id === e.source);
      const tgt = nodes.find(n => n.id === e.target);
      if (!src || !tgt) return;
      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const stretch = dist - SPRING_LEN;
      const f = SPRING_K * stretch;
      fx[src.id] += (f * dx) / dist;
      fy[src.id] += (f * dy) / dist;
      fx[tgt.id] -= (f * dx) / dist;
      fy[tgt.id] -= (f * dy) / dist;
    });

    // Gravity toward canvas center
    nodes.forEach(n => {
      fx[n.id] += (CX - n.x) * GRAVITY;
      fy[n.id] += (CY - n.y) * GRAVITY;
    });

    // Apply forces (damped)
    const damping = 1 - iter / (ITERS * 1.5); // gradually reduce movement
    nodes = nodes.map(n => ({
      ...n,
      x: Math.max(NODE_R + 20, Math.min(CANVAS_W - NODE_R - 20, n.x + fx[n.id] * 0.012 * damping)),
      y: Math.max(NODE_R + 20, Math.min(CANVAS_H - NODE_R - 20, n.y + fy[n.id] * 0.012 * damping)),
    }));
  }

  return nodes;
}

// ── Edge path helpers ────────────────────────────────────────────────────────

/** Curved bezier edge from node A to node B, stopping just before the circle border */
function curvePath(src: KNode, tgt: KNode): string {
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;

  // Start/end on circle edges (leave room for arrowhead marker)
  const x1 = src.x + (NODE_R * dx) / dist;
  const y1 = src.y + (NODE_R * dy) / dist;
  const x2 = tgt.x - ((NODE_R + 10) * dx) / dist;
  const y2 = tgt.y - ((NODE_R + 10) * dy) / dist;

  // Perpendicular control point for a gentle curve
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const curveOffset = Math.min(dist * 0.25, 50);
  const cpx = mx - (curveOffset * dy) / dist;
  const cpy = my + (curveOffset * dx) / dist;

  return `M ${x1} ${y1} Q ${cpx} ${cpy} ${x2} ${y2}`;
}

/** Midpoint on bezier curve for label placement */
function bezierMid(src: KNode, tgt: KNode): { x: number; y: number } {
  const dx = tgt.x - src.x;
  const dy = tgt.y - src.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const x1 = src.x + (NODE_R * dx) / dist;
  const y1 = src.y + (NODE_R * dy) / dist;
  const x2 = tgt.x - ((NODE_R + 10) * dx) / dist;
  const y2 = tgt.y - ((NODE_R + 10) * dy) / dist;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const curveOffset = Math.min(dist * 0.25, 50);
  const cpx = mx - (curveOffset * dy) / dist;
  const cpy = my + (curveOffset * dx) / dist;
  // Point at t=0.5 on quadratic bezier
  return {
    x: 0.25 * x1 + 0.5 * cpx + 0.25 * x2,
    y: 0.25 * y1 + 0.5 * cpy + 0.25 * y2,
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function GraphScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ moduleId?: string; mode?: string }>();
  const moduleId = params.moduleId ? parseInt(params.moduleId) : undefined;
  const isModuleGraph  = moduleId !== undefined;
  const isGlobalGraph  = params.mode === 'global';

  const [nodes, setNodes] = useState<KNode[]>([]);
  const [edges, setEdges] = useState<KEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<KNode | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [moduleName, setModuleName] = useState('');
  const [degreeMap, setDegreeMap] = useState<Record<number, number>>({});

  // ── Pan / zoom state ───────────────────────────────────────────────────────
  // viewPan: which canvas point is centred on screen. Starts at canvas centre.
  const [viewPan, setViewPan]     = useState({ x: CX, y: CY });
  const [viewScale, setViewScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ w: SW, h: SH * 0.72 });

  // Link-from mode: tap another node to create a link from a gap node
  const [linkFromId, setLinkFromId] = useState<number | null>(null);
  const [linkFromLoading, setLinkFromLoading] = useState(false);

  // Mutable refs so PanResponder callbacks (stable closures) always see latest values
  const viewPanRef    = useRef({ x: CX, y: CY });
  const viewScaleRef  = useRef(1);
  const nodesRef      = useRef<KNode[]>([]);
  const degreeMapRef  = useRef<Record<number, number>>({});
  const orphanIdsRef  = useRef<Set<number>>(new Set());
  const linkFromIdRef = useRef<number | null>(null);
  const canvasSizeRef = useRef({ w: SW, h: SH * 0.72, pageX: 0, pageY: 0 });
  const canvasViewRef = useRef<View>(null);

  // Animated panel: starts off-screen (PANEL_W = fully right), slides to 0 when node selected
  const panelAnim = useRef(new Animated.Value(PANEL_W)).current;

  // Sync state → refs
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { degreeMapRef.current = degreeMap; }, [degreeMap]);
  useEffect(() => { linkFromIdRef.current = linkFromId; }, [linkFromId]);

  // Animate right panel in/out based on selection
  useEffect(() => {
    Animated.spring(panelAnim, {
      toValue: selected ? 0 : PANEL_W,
      useNativeDriver: true,
      speed: 18,
      bounciness: 3,
    }).start();
  }, [selected]);

  // Reset view when graph is (re)loaded
  useEffect(() => {
    if (nodes.length > 0) {
      viewPanRef.current = { x: CX, y: CY };
      viewScaleRef.current = 1;
      setViewPan({ x: CX, y: CY });
      setViewScale(1);
    }
  }, [nodes]);

  // ── Zoom helpers ───────────────────────────────────────────────────────────
  const fitGraph = () => {
    viewPanRef.current = { x: CX, y: CY };
    viewScaleRef.current = 1;
    setViewPan({ x: CX, y: CY });
    setViewScale(1);
  };
  const zoomBy = (factor: number) => {
    const s = Math.max(0.12, Math.min(5, viewScaleRef.current * factor));
    viewScaleRef.current = s;
    setViewScale(s);
  };

  // ── PanResponder: handles pan + tap-to-select without a ScrollView ─────────
  const panStartRef      = useRef({ x: CX, y: CY });
  const touchStartRef    = useRef({ x: 0, y: 0, t: 0 });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  (_, gs) => Math.abs(gs.dx) > 4 || Math.abs(gs.dy) > 4,

      onPanResponderGrant: (_, gs) => {
        touchStartRef.current = { x: gs.x0, y: gs.y0, t: Date.now() };
        panStartRef.current   = { ...viewPanRef.current };
        // Re-measure absolute position on every touch so header/status-bar
        // offsets are always current (avoids stale pageX/pageY after scroll/layout).
        canvasViewRef.current?.measureInWindow((px, py, w, h) => {
          canvasSizeRef.current = { w, h, pageX: px, pageY: py };
        });
      },

      onPanResponderMove: (_, gs) => {
        const s = viewScaleRef.current;
        const nx = panStartRef.current.x - gs.dx / s;
        const ny = panStartRef.current.y - gs.dy / s;
        viewPanRef.current = { x: nx, y: ny };
        setViewPan({ x: nx, y: ny });
      },

      onPanResponderRelease: (_, gs) => {
        const moved  = Math.abs(gs.dx) + Math.abs(gs.dy);
        const elapsed = Date.now() - touchStartRef.current.t;
        if (moved < 18 && elapsed < 500) {
          // ── Tap: hit-test nodes ──────────────────────────────────────────
          const { w, h, pageX: ox, pageY: oy } = canvasSizeRef.current;
          const scale = viewScaleRef.current;
          const pan   = viewPanRef.current;
          // Convert absolute screen tap → canvas coordinates
          const canX  = (gs.x0 - ox - w / 2) / scale + pan.x;
          const canY  = (gs.y0 - oy - h / 2) / scale + pan.y;
          const dm    = degreeMapRef.current;
          const orphans = orphanIdsRef.current;
          const hit   = nodesRef.current.find(n => {
            const visualR = Math.min(38, 18 + (dm[n.id] || 0) * 3);
            // Gap nodes get a larger hit radius since they're small but important to tap
            const hitR = orphans.has(n.id) ? visualR + 22 : visualR + 10;
            return Math.hypot(n.x - canX, n.y - canY) < hitR;
          });

          const fromId = linkFromIdRef.current;
          if (fromId !== null) {
            // Link-from mode: tapping a node creates a link; tapping canvas cancels
            if (hit && hit.id !== fromId) {
              setLinkFromId(null);
              // trigger async link creation (state update via loadGraph after)
              setSelected(null);
              // pass hit + fromId through to createLinkAsync
              createLinkFromRef.current(fromId, hit.id);
            } else if (!hit) {
              setLinkFromId(null);
            }
          } else {
            if (hit) setSelected(prev => (prev?.id === hit.id ? null : hit));
            else      setSelected(null);
          }
        }
      },
    })
  ).current;

  // Stable ref so PanResponder closure can call latest createLinkAsync
  const createLinkFromRef = useRef<(fromId: number, toId: number) => void>(() => {});

  // ── Create a link between two nodes (graph or module) ─────────────────────
  const createLinkAsync = async (fromId: number, toId: number) => {
    setLinkFromLoading(true);
    try {
      if (isModuleGraph && moduleId) {
        // Module graph: fetch row and update linked_row_ids
        const { data: mod } = await modulesAPI.get(moduleId);
        const sourceRow = mod.rows.find((r: any) => r.id === fromId);
        if (sourceRow && !sourceRow.linked_row_ids.includes(toId)) {
          await modulesAPI.updateRow(moduleId, fromId, {
            data: sourceRow.data,
            linked_row_ids: [...sourceRow.linked_row_ids, toId],
            linked_knowledge_ids: sourceRow.linked_knowledge_ids,
          });
        }
      } else {
        // Knowledge / global graph: use knowledge link API
        await knowledgeAPI.addLink(fromId, toId, '');
      }
      await loadGraph();
    } catch (e) {
      Alert.alert('Error', 'Could not create link. Please try again.');
    }
    setLinkFromLoading(false);
  };

  // Keep ref current so PanResponder (stable closure) always calls latest version
  useEffect(() => { createLinkFromRef.current = createLinkAsync; });

  useEffect(() => { loadGraph(); }, [moduleId]);

  const loadGraph = async () => {
    setLoading(true);
    setSelected(null);
    setLinkFromId(null);
    try {
      if (isGlobalGraph) {
        await loadGlobalModuleGraph();
      } else if (isModuleGraph && moduleId) {
        await loadModuleGraph(moduleId);
      } else {
        await loadKnowledgeGraph();
      }
    } catch { }
    setLoading(false);
  };

  // ── Global cross-module graph ─────────────────────────────────────────────────

  const loadGlobalModuleGraph = async () => {
    const { data: modList } = await modulesAPI.list();
    const allNodes: KNode[] = [];
    const allEdges: KEdge[] = [];
    const moduleColorMap: Record<number, string> = {};

    await Promise.all(
      modList.slice(0, 12).map(async (m: any, mi: number) => {
        moduleColorMap[m.id] = MODULE_ROW_COLORS[mi % MODULE_ROW_COLORS.length];
        try {
          const { data: mod } = await modulesAPI.get(m.id);
          mod.rows.forEach((row: any, ri: number) => {
            const firstCol = mod.column_definitions[0]?.name;
            const title = (firstCol && row.data[firstCol]?.trim()) || `${m.name} · ${ri + 1}`;
            allNodes.push({
              id: row.id,
              title,
              category: moduleColorMap[m.id],
              summary: `[${m.name}] ` + Object.entries(row.data)
                .filter(([k]) => !k.startsWith('__'))
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')
                .slice(0, 120),
              x: CX + (Math.random() - 0.5) * 300,
              y: CY + (Math.random() - 0.5) * 300,
            });
            // Within-module links
            (row.linked_row_ids || []).forEach((targetId: number) => {
              let label = '';
              try { label = JSON.parse(row.data['__lm__'] || '{}')[String(targetId)]?.label || ''; } catch {}
              allEdges.push({ source: row.id, target: targetId, label, directed: true });
            });
            // Cross-module links
            try {
              const xl = JSON.parse(row.data['__xl__'] || '[]');
              xl.forEach((x: any) => {
                allEdges.push({ source: row.id, target: x.rid, label: x.label || '', directed: true });
              });
            } catch {}
          });
        } catch {}
      })
    );

    const laid = forceLayout(allNodes, allEdges);
    const dm: Record<number, number> = {};
    laid.forEach(n => { dm[n.id] = 0; });
    allEdges.forEach(e => {
      dm[e.source] = (dm[e.source] || 0) + 1;
      dm[e.target] = (dm[e.target] || 0) + 1;
    });
    setModuleName('All Modules');
    setDegreeMap(dm);
    setNodes(laid);
    setEdges(allEdges);
  };

  const loadKnowledgeGraph = async () => {
    const { data: items } = await knowledgeAPI.list({ limit: 100 });
    const initial = circleLayout(
      items.map((item: any) => ({
        id: item.id,
        title: item.title,
        category: item.category || 'General',
        summary: item.summary || '',
      }))
    );

    // Load all edges first, then run layout with them
    const allEdges: KEdge[] = [];
    await Promise.all(
      items.map(async (item: any) => {
        try {
          const { data: links } = await knowledgeAPI.getLinks(item.id);
          links.forEach((l: any) => {
            allEdges.push({ source: l.source_id, target: l.target_id, label: l.label, directed: false });
          });
        } catch { /* skip */ }
      })
    );

    const laid = forceLayout(initial, allEdges);
    const dm: Record<number, number> = {};
    laid.forEach(n => { dm[n.id] = 0; });
    allEdges.forEach(e => {
      dm[e.source] = (dm[e.source] || 0) + 1;
      dm[e.target] = (dm[e.target] || 0) + 1;
    });
    setDegreeMap(dm);
    setNodes(laid);
    setEdges(allEdges);
  };

  const loadModuleGraph = async (mid: number) => {
    const { data: mod } = await modulesAPI.get(mid);
    setModuleName(mod.name);

    const items = mod.rows.map((row: any, i: number) => ({
      id: row.id,
      title: (() => {
        const firstCol = mod.column_definitions[0]?.name;
        return (firstCol && row.data[firstCol]?.trim()) || `Row ${row.position + 1}`;
      })(),
      category: MODULE_ROW_COLORS[i % MODULE_ROW_COLORS.length],
      summary: Object.entries(row.data).map(([k, v]) => `${k}: ${v}`).join(' · ') || '',
    }));

    const edgesFromLinks: KEdge[] = [];
    mod.rows.forEach((row: any) => {
      (row.linked_row_ids || []).forEach((targetId: number) => {
        let label = '';
        try {
          const lm = JSON.parse(row.data['__lm__'] || '{}');
          label = lm[String(targetId)]?.label || '';
        } catch {}
        edgesFromLinks.push({ source: row.id, target: targetId, label, directed: true });
      });
    });

    const initial = circleLayout(items);
    const laid = forceLayout(initial, edgesFromLinks);

    // For module graph: use row-specific colors as category
    const coloredNodes = laid.map((n, i) => ({
      ...n,
      category: MODULE_ROW_COLORS[i % MODULE_ROW_COLORS.length],
    }));

    // Compute degree map
    const dm: Record<number, number> = {};
    coloredNodes.forEach(n => { dm[n.id] = 0; });
    edgesFromLinks.forEach(e => {
      dm[e.source] = (dm[e.source] || 0) + 1;
      dm[e.target] = (dm[e.target] || 0) + 1;
    });
    setDegreeMap(dm);
    setNodes(coloredNodes);
    setEdges(edgesFromLinks);
  };

  const suggestLinks = async (node: KNode) => {
    if (isModuleGraph) return; // only for knowledge graph
    setSuggesting(true);
    try {
      const { data } = await knowledgeAPI.suggestLinks(node.id);
      if (!data.suggested?.length) {
        Alert.alert('No suggestions', 'No related items found for this node.');
        setSuggesting(false);
        return;
      }
      Alert.alert(
        'Suggested Links',
        data.suggested.map((s: any) => `• ${s.title}`).join('\n'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: `Link all (${data.suggested.length})`,
            onPress: async () => {
              for (const s of data.suggested) {
                try { await knowledgeAPI.addLink(node.id, s.id); } catch { }
              }
              loadGraph();
            },
          },
        ]
      );
    } catch { }
    setSuggesting(false);
  };

  const nodeById = (id: number) => nodes.find(n => n.id === id);

  const connectedEdges = selected
    ? edges.filter(e => e.source === selected.id || e.target === selected.id)
    : [];

  // Entry-point detection: nodes with no incoming directed edges are "start" nodes.
  // For undirected graphs (knowledge graph), the highest-degree node is the entry.
  const hasIncomingSet = new Set(edges.filter(e => e.directed).map(e => e.target));
  const topDegreeId = nodes.reduce<number | null>(
    (best, n) => best === null || (degreeMap[n.id] || 0) > (degreeMap[best] || 0) ? n.id : best,
    null
  );
  const entryNodeIds = new Set(
    isModuleGraph
      ? nodes.filter(n => !hasIncomingSet.has(n.id)).map(n => n.id)
      : (topDegreeId !== null ? [topDegreeId] : [])
  );

  // Gap / orphan detection — nodes with 0 connections are knowledge gaps
  const orphanIds = new Set(nodes.filter(n => (degreeMap[n.id] || 0) === 0).map(n => n.id));
  const orphanCount = orphanIds.size;
  // Keep ref in sync so PanResponder stable closures can access current orphan set
  orphanIdsRef.current = orphanIds;

  // Bridge node approximation: nodes that are the only link between two others
  // (degree == 1 in a subgraph, not orphan) — coloured amber
  const bridgeIds = new Set(
    nodes.filter(n => {
      const d = degreeMap[n.id] || 0;
      return d === 1;
    }).map(n => n.id)
  );

  const nodeColor = (node: KNode) => {
    const deg = degreeMap[node.id] || 0;
    if (orphanIds.has(node.id)) return '#FF9800';  // orange — knowledge gap
    if (deg >= 4) return '#FF6B6B';               // red    — hub node
    return isModuleGraph ? node.category : categoryColor(node.category);
  };

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <GraphHeader
          title={isModuleGraph ? moduleName || 'Module Graph' : 'Knowledge Graph'}
          onBack={() => router.back()}
          onRefresh={loadGraph}
          isModule={isModuleGraph}
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>
            {isModuleGraph ? 'Building module graph…' : 'Building knowledge graph…'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  if (nodes.length === 0) {
    return (
      <SafeAreaView style={styles.safe}>
        <GraphHeader
          title={isModuleGraph ? moduleName || 'Module Graph' : 'Knowledge Graph'}
          onBack={() => router.back()}
          onRefresh={loadGraph}
          isModule={isModuleGraph}
        />
        <View style={styles.centered}>
          <Ionicons name="git-network-outline" size={56} color={Colors.primaryLight} />
          <Text style={styles.emptyTitle}>
            {isModuleGraph ? 'No rows in module' : 'No knowledge yet'}
          </Text>
          <Text style={styles.emptyText}>
            {isModuleGraph
              ? 'Add rows to this module to visualize connections.'
              : 'Add knowledge items to see your graph.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Graph ──────────────────────────────────────────────────────────────────

  // Compact stats for top bar
  const statsBar = (
    <View style={styles.statsBar}>
      <View style={styles.stat}>
        <Text style={styles.statNum}>{nodes.length}</Text>
        <Text style={styles.statLabel}>{isModuleGraph ? 'rows' : 'nodes'}</Text>
      </View>
      <View style={styles.statDiv} />
      <View style={styles.stat}>
        <Text style={styles.statNum}>{edges.length}</Text>
        <Text style={styles.statLabel}>links</Text>
      </View>
      {orphanCount > 0 && (
        <>
          <View style={styles.statDiv} />
          <View style={styles.stat}>
            <Text style={[styles.statNum, { color: '#FF9800' }]}>{orphanCount}</Text>
            <Text style={styles.statLabel}>gaps</Text>
          </View>
        </>
      )}
      <Text style={[styles.moduleHint, { flex: 1 }]}>
        {linkFromId !== null
          ? `Linking from "${nodes.find(n => n.id === linkFromId)?.title?.slice(0, 18) ?? '?'}"…`
          : selected
            ? selected.title.slice(0, 22)
            : 'Tap a node to inspect'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <GraphHeader
        title={isGlobalGraph ? 'Global Graph' : isModuleGraph ? (moduleName || 'Module Graph') : 'Knowledge Graph'}
        onBack={() => router.back()}
        onRefresh={loadGraph}
        isModule={isModuleGraph || isGlobalGraph}
      />

      {statsBar}

      {/* Main area — canvas is absoluteFill, panel overlays from right */}
      <View style={{ flex: 1 }}>
        {/* SVG Canvas — full screen width, PanResponder for pan + tap */}
        <View
          ref={canvasViewRef}
          style={[StyleSheet.absoluteFill, { backgroundColor: '#0D0D1A', overflow: 'hidden' }]}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setCanvasSize({ w: width, h: height });
            canvasViewRef.current?.measureInWindow((px, py) => {
              canvasSizeRef.current = { w: width, h: height, pageX: px, pageY: py };
            });
          }}
          {...panResponder.panHandlers}
        >
          {/* Link-from hint */}
          {(linkFromId !== null || linkFromLoading) && (
            <View style={styles.linkFromHint} pointerEvents="none">
              {linkFromLoading
                ? <ActivityIndicator size="small" color={Colors.white} />
                : <Ionicons name="link-outline" size={13} color={Colors.white} />
              }
              <Text style={styles.linkFromHintTxt}>
                {linkFromLoading ? 'Creating link…' : 'Tap a node to connect — or tap canvas to cancel'}
              </Text>
            </View>
          )}

          <Svg width={canvasSize.w} height={canvasSize.h}>
            <Defs>
              <Marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <Path d="M 0 0 L 8 4 L 0 8 L 2 4 Z" fill={Colors.primary} opacity={0.75} />
              </Marker>
              <Marker id="arrow-dim" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <Path d="M 0 0 L 8 4 L 0 8 L 2 4 Z" fill={Colors.border} />
              </Marker>
            </Defs>

            <G transform={`translate(${canvasSize.w / 2 - viewPan.x * viewScale} ${canvasSize.h / 2 - viewPan.y * viewScale}) scale(${viewScale})`}>

              {/* Edges */}
              {edges.map((edge, i) => {
                const src = nodeById(edge.source);
                const tgt = nodeById(edge.target);
                if (!src || !tgt) return null;
                const d = curvePath(src, tgt);
                const mid = bezierMid(src, tgt);
                const isHighlighted = selected
                  ? edge.source === selected.id || edge.target === selected.id
                  : false;
                return (
                  <G key={`e${i}`}>
                    <Path
                      d={d}
                      stroke={isHighlighted ? Colors.primary : Colors.border}
                      strokeWidth={isHighlighted ? 2.5 : 1.5}
                      fill="none"
                      strokeLinecap="round"
                      markerEnd={edge.directed ? (isHighlighted ? 'url(#arrow)' : 'url(#arrow-dim)') : undefined}
                      opacity={selected ? (isHighlighted ? 1 : 0.25) : 0.65}
                    />
                    {edge.label ? (
                      <G>
                        <Rect x={mid.x - 22} y={mid.y - 8} width={44} height={14} rx={3} fill="#1A1A2E" opacity={0.9} />
                        <SvgText x={mid.x} y={mid.y + 4} textAnchor="middle" fontSize={9} fill="rgba(255,255,255,0.7)">
                          {edge.label.slice(0, 14)}
                        </SvgText>
                      </G>
                    ) : null}
                  </G>
                );
              })}

              {/* Nodes */}
              {nodes.map((node) => {
                const color = nodeColor(node);
                const deg = degreeMap[node.id] || 0;
                const nr = Math.min(38, 18 + deg * 3);
                const isHub   = deg >= 4;
                const isEntry = entryNodeIds.has(node.id);
                const isSel   = selected?.id === node.id;
                const isConn  = selected
                  ? edges.some(e => (e.source === selected.id && e.target === node.id)
                                  || (e.target === selected.id && e.source === node.id))
                  : false;
                const dimmed = !!selected && !isSel && !isConn;
                return (
                  <G key={`n${node.id}`}>
                    {isHub && <Circle cx={node.x} cy={node.y} r={nr + 10} fill={color} opacity={0.08} />}
                    {isSel  && <Circle cx={node.x} cy={node.y} r={nr + 8} fill="none" stroke={color} strokeWidth={2.5} opacity={0.8} strokeDasharray="5,3" />}
                    {isConn && !isSel && <Circle cx={node.x} cy={node.y} r={nr + 5} fill={color} opacity={0.12} />}
                    <Circle cx={node.x} cy={node.y} r={nr + 4} fill={color} opacity={dimmed ? 0.04 : 0.14} />
                    <Circle cx={node.x} cy={node.y} r={nr} fill={color} opacity={dimmed ? 0.3 : 1} />
                    <SvgText x={node.x} y={node.y + 5} textAnchor="middle" fontSize={isHub ? 16 : 13}
                      fontWeight="bold" fill="white" opacity={dimmed ? 0.3 : 1}>
                      {node.title[0]?.toUpperCase() ?? '?'}
                    </SvgText>
                    <SvgText x={node.x} y={node.y + nr + 14} textAnchor="middle"
                      fontSize={isHub ? 11 : 10} fontWeight={isHub ? 'bold' : 'normal'}
                      fill={isHub ? color : 'rgba(255,255,255,0.85)'} opacity={dimmed ? 0.25 : 0.9}>
                      {node.title.length > 14 ? node.title.slice(0, 13) + '…' : node.title}
                    </SvgText>
                    {isEntry && !orphanIds.has(node.id) && (
                      <G opacity={dimmed ? 0.25 : 1}>
                        <Rect x={node.x - 24} y={node.y - nr - 20} width={48} height={16} rx={8}
                          fill={isHub ? '#FF6B6B' : '#4CAF50'} />
                        <SvgText x={node.x} y={node.y - nr - 7} textAnchor="middle"
                          fontSize={9} fontWeight="bold" fill="white">
                          {isHub ? '★ HUB' : '▶ START'}
                        </SvgText>
                      </G>
                    )}
                    {orphanIds.has(node.id) && (
                      <G opacity={dimmed ? 0.25 : 1}>
                        <Rect x={node.x - 20} y={node.y - nr - 20} width={40} height={16} rx={8}
                          fill="#FF9800" />
                        <SvgText x={node.x} y={node.y - nr - 7} textAnchor="middle"
                          fontSize={9} fontWeight="bold" fill="white">
                          ◆ GAP
                        </SvgText>
                      </G>
                    )}
                  </G>
                );
              })}
            </G>
          </Svg>
        </View>

        {/* Floating zoom controls — bottom-left, always accessible */}
        <View style={styles.floatingControls} pointerEvents="box-none">
          <TouchableOpacity onPress={() => zoomBy(1.35)} style={styles.floatBtn}>
            <Ionicons name="add" size={20} color={Colors.white} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => zoomBy(1 / 1.35)} style={styles.floatBtn}>
            <Ionicons name="remove" size={20} color={Colors.white} />
          </TouchableOpacity>
          <TouchableOpacity onPress={fitGraph} style={styles.floatBtn}>
            <Ionicons name="scan-outline" size={18} color={Colors.white} />
          </TouchableOpacity>
        </View>

        {/* Animated overlay panel — slides in from right when node is selected */}
        <Animated.View style={[styles.overlayPanel, { transform: [{ translateX: panelAnim }] }]}>
          {selected && (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 32 }}>
              {/* Header row — color dot, title, close */}
              <View style={styles.rpHeader}>
                <View style={[styles.rpDot, { backgroundColor: nodeColor(selected) }]} />
                <Text style={styles.rpTitle} numberOfLines={3}>{selected.title}</Text>
                <TouchableOpacity onPress={() => setSelected(null)} style={{ padding: 6 }}>
                  <Ionicons name="close" size={18} color="rgba(255,255,255,0.6)" />
                </TouchableOpacity>
              </View>

              {!isModuleGraph && (
                <Text style={styles.rpCat}>{selected.category}</Text>
              )}

              {/* Gap warning */}
              {orphanIds.has(selected.id) && (
                <View style={styles.rpGapBadge}>
                  <Ionicons name="warning-outline" size={12} color="#FF9800" />
                  <Text style={styles.rpGapText}>No connections — knowledge gap</Text>
                </View>
              )}

              {/* Summary */}
              {selected.summary ? (
                <Text style={styles.rpSummary} numberOfLines={5}>{selected.summary}</Text>
              ) : null}

              {/* Link to Node */}
              <TouchableOpacity
                style={[styles.rpBtn, orphanIds.has(selected.id) && { backgroundColor: '#FF9800' }]}
                onPress={() => { const id = selected.id; setSelected(null); setLinkFromId(id); }}
              >
                <Ionicons name="link-outline" size={14} color={Colors.white} />
                <Text style={styles.rpBtnTxt}>Link to Node</Text>
              </TouchableOpacity>

              {/* AI Suggest (knowledge graph only) */}
              {!isModuleGraph && (
                <TouchableOpacity
                  style={[styles.rpBtn, { backgroundColor: Colors.primaryDark }]}
                  onPress={() => { setSelected(null); suggestLinks(selected); }}
                  disabled={suggesting}
                >
                  {suggesting
                    ? <ActivityIndicator size="small" color={Colors.white} />
                    : <>
                        <Ionicons name="git-merge-outline" size={14} color={Colors.white} />
                        <Text style={styles.rpBtnTxt}>AI Suggest</Text>
                      </>
                  }
                </TouchableOpacity>
              )}

              {/* Open in Library / Table View */}
              <TouchableOpacity
                style={[styles.rpBtn, { backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }]}
                onPress={() => { setSelected(null); if (isModuleGraph) router.back(); else router.push('/(tabs)/knowledge'); }}
              >
                <Ionicons name="open-outline" size={14} color={Colors.primaryLight} />
                <Text style={[styles.rpBtnTxt, { color: Colors.primaryLight }]}>
                  {isModuleGraph ? 'Table View' : 'Library'}
                </Text>
              </TouchableOpacity>

              {/* Connections list */}
              {connectedEdges.length > 0 && (
                <View style={{ marginTop: 10 }}>
                  <Text style={styles.rpConnLabel}>
                    CONNECTIONS ({connectedEdges.length})
                  </Text>
                  {connectedEdges.filter(e => e.source === selected.id).map((e, i) => {
                    const other = nodeById(e.target);
                    return other ? (
                      <TouchableOpacity key={`out${i}`} style={styles.rpConnItem} onPress={() => setSelected(other)}>
                        <Ionicons name="arrow-forward-outline" size={11} color={Colors.primary} />
                        <View style={[styles.rpConnDot, { backgroundColor: nodeColor(other) }]} />
                        <Text style={styles.rpConnTxt} numberOfLines={1}>{other.title}</Text>
                      </TouchableOpacity>
                    ) : null;
                  })}
                  {connectedEdges.filter(e => e.target === selected.id).map((e, i) => {
                    const other = nodeById(e.source);
                    return other ? (
                      <TouchableOpacity key={`in${i}`} style={styles.rpConnItem} onPress={() => setSelected(other)}>
                        <Ionicons name="arrow-back-outline" size={11} color="rgba(255,255,255,0.5)" />
                        <View style={[styles.rpConnDot, { backgroundColor: nodeColor(other) }]} />
                        <Text style={[styles.rpConnTxt, { color: 'rgba(255,255,255,0.55)' }]} numberOfLines={1}>{other.title}</Text>
                      </TouchableOpacity>
                    ) : null;
                  })}
                </View>
              )}
            </ScrollView>
          )}
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function GraphHeader({
  title, onBack, onRefresh, isModule,
}: {
  title: string;
  onBack: () => void;
  onRefresh: () => void;
  isModule: boolean;
}) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.headerBtn}>
        <Ionicons name="arrow-back" size={22} color={Colors.white} />
      </TouchableOpacity>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        {isModule && (
          <Text style={styles.headerSub}>Module Graph</Text>
        )}
      </View>
      <TouchableOpacity onPress={onRefresh} style={styles.headerBtn}>
        <Ionicons name="refresh" size={20} color={Colors.white} />
      </TouchableOpacity>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0D0D1A' }, // dark canvas background
  header: {
    backgroundColor: Colors.primaryDark,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  headerBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '700' },
  headerSub: { color: 'rgba(255,255,255,0.6)', fontSize: 10, marginTop: 1 },
  statsBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.primaryDark,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16, paddingVertical: 7,
  },
  stat: { alignItems: 'center', paddingHorizontal: 8 },
  statNum: { fontSize: 15, fontWeight: '800', color: Colors.white },
  statLabel: { fontSize: 9, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 },
  statDiv: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 10, color: 'rgba(255,255,255,0.7)' },
  moduleHint: { fontSize: 10, color: 'rgba(255,255,255,0.5)', flex: 1, paddingLeft: 8 },
  linkFromHint: {
    position: 'absolute', top: 10, left: 16, right: 16, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(59,82,204,0.92)', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  linkFromHintTxt: { flex: 1, color: Colors.white, fontSize: 12 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: Colors.textSecondary, fontSize: FontSizes.sm },
  emptyTitle: { fontSize: FontSizes.lg, fontWeight: '700', color: Colors.primary },
  emptyText: {
    fontSize: FontSizes.sm, color: Colors.textSecondary,
    textAlign: 'center', paddingHorizontal: 40,
  },
  // Floating zoom controls (bottom-left of canvas)
  floatingControls: {
    position: 'absolute',
    bottom: 20,
    left: 14,
    gap: 8,
  },
  floatBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(59,82,204,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
  },
  // Animated overlay right panel
  overlayPanel: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: PANEL_W,
    backgroundColor: 'rgba(8,8,20,0.97)',
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingTop: 14,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  rpHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 6,
  },
  rpDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3, flexShrink: 0 },
  rpTitle: {
    flex: 1, fontSize: 12, fontWeight: '700', color: Colors.white, lineHeight: 17,
  },
  rpCat: { fontSize: 10, color: Colors.primaryLight, marginBottom: 5, fontStyle: 'italic' },
  rpGapBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,152,0,0.15)', borderRadius: 6,
    padding: 6, marginBottom: 6,
  },
  rpGapText: { fontSize: 10, color: '#FF9800', flex: 1, lineHeight: 14 },
  rpSummary: {
    fontSize: 10, color: 'rgba(255,255,255,0.55)', lineHeight: 14, marginBottom: 8,
  },
  rpBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary, borderRadius: 7,
    paddingHorizontal: 8, paddingVertical: 7, marginBottom: 6,
  },
  rpBtnTxt: { fontSize: 11, fontWeight: '700', color: Colors.white },
  rpConnLabel: {
    fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.7, marginBottom: 4,
  },
  rpConnItem: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rpConnDot: { width: 8, height: 8, borderRadius: 4 },
  rpConnTxt: { flex: 1, fontSize: 10, color: 'rgba(255,255,255,0.75)' },
});
