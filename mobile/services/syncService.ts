/**
 * Sync service — bidirectional sync between local SQLite and backend.
 *
 * Pull: download all server knowledge → save locally
 * Push: flush sync_queue → send pending local changes to server
 *
 * Call syncAll() on app foreground or when network comes back online.
 */
import NetInfo from '@react-native-community/netinfo';
import { knowledgeAPI, queryAPI } from './api';
import {
  saveKnowledgeLocal,
  saveQueryLocal,
  getPendingSync,
  clearSyncItem,
  queueSync,
} from './localDB';

export async function isOnline(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return !!(state.isConnected && state.isInternetReachable);
}

export async function pullFromServer(): Promise<void> {
  if (!(await isOnline())) return;
  try {
    const { data: items } = await knowledgeAPI.list({ limit: 200 });
    for (const item of items) {
      await saveKnowledgeLocal({
        server_id: item.id,
        title: item.title,
        content: item.content,
        summary: item.summary,
        category: item.category,
        tags: item.tags,
        source_type: item.source_type,
        is_public: item.is_public,
        price: item.price,
        updated_at: item.updated_at,
        synced: true,
      });
    }

    const { data: history } = await queryAPI.history(50);
    for (const h of history) {
      await saveQueryLocal({
        server_id: h.id,
        query_text: h.query_text,
        answer_text: h.answer_text,
        sources: h.sources,
      });
    }
  } catch {
    // silent — offline pull fails gracefully
  }
}

export async function pushToServer(): Promise<void> {
  if (!(await isOnline())) return;
  const pending = await getPendingSync();
  for (const item of pending) {
    try {
      const payload = JSON.parse(item.payload);
      if (item.entity === 'knowledge') {
        if (item.action === 'create') await knowledgeAPI.create(payload);
        if (item.action === 'update') await knowledgeAPI.update(payload.id, payload);
        if (item.action === 'delete') await knowledgeAPI.delete(payload.id);
      }
      await clearSyncItem(item.id);
    } catch {
      // leave in queue to retry next sync
    }
  }
}

export async function syncAll(): Promise<void> {
  await pushToServer();
  await pullFromServer();
}

/** Save a knowledge item locally and queue it for server sync. */
export async function saveKnowledgeWithSync(data: {
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  source_type?: string;
}) {
  // Save offline immediately
  await saveKnowledgeLocal({ ...data, synced: false });
  // Queue push
  await queueSync('create', 'knowledge', data);
  // Try push now if online
  await pushToServer();
}
