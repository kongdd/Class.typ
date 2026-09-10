import { useEffect, useState } from 'react';

export type Pane = 'tutorial' | 'notes';
export type Chapter = { id: string; title: string; tutorial: string; notes: string };
type Draft = {
  id: string;
  pane: Pane;
  base: string;
  source: string;
  status: 'pending' | 'saving' | 'error';
  error?: string;
};
const keyOf = (id: string, pane: Pane) => `${id}/${pane}`;

export function useDocuments(role: 'teacher' | 'student') {
  const [disk, setDisk] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [connectionError, setConnectionError] = useState('');

  useEffect(() => {
    const events = new EventSource('/api/live');
    events.onmessage = event => {
      const live = JSON.parse(event.data) as { activeId: string; chapters: Chapter[] };
      setDisk(live.chapters);
      setConnectionError('');
      setActiveId(current => role === 'student' || !live.chapters.some(item => item.id === current)
        ? live.activeId || live.chapters[0]?.id || '' : current);
    };
    events.onerror = () => setConnectionError('同步连接中断，正在重连；网页草稿仍保留。');
    return () => events.close();
  }, [role]);

  useEffect(() => {
    if (role !== 'teacher' || !activeId) return;
    fetch('/api/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeId }),
    }).catch(() => setConnectionError('章节同步失败，正在等待连接恢复。'));
  }, [role, activeId]);

  // Only explicit edits create drafts. Navigation and disk updates never write files.
  useEffect(() => {
    if (role !== 'teacher') return;
    const timers = Object.entries(drafts).filter(([, draft]) => draft.status === 'pending')
      .map(([key, draft]) => setTimeout(async () => {
        setDrafts(current => ({ ...current, [key]: { ...current[key], status: 'saving' } }));
        try {
          const response = await fetch('/api/file', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: draft.id, pane: draft.pane, base: draft.base, source: draft.source }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || `保存失败（${response.status}）`);
          // A newer disk event may already have arrived; don't replace it with an old acknowledgement.
          setDisk(current => current.map(item => item.id === draft.id && item[draft.pane] === draft.base
            ? { ...item, [draft.pane]: draft.source } : item));
          setDrafts(current => {
            const next = { ...current };
            if (next[key].source === draft.source) delete next[key];
            else next[key] = { ...next[key], base: draft.source, status: 'pending' };
            return next;
          });
        } catch (error) {
          setDrafts(current => ({ ...current, [key]: {
            ...current[key], status: 'error', error: error instanceof Error ? error.message : String(error),
          } }));
        }
      }, 400));
    return () => timers.forEach(clearTimeout);
  }, [drafts, role]);

  const unsaved = Object.values(drafts);
  useEffect(() => {
    if (!unsaved.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved.length]);

  function edit(id: string, pane: Pane, source: string) {
    if (role !== 'teacher') return;
    const chapter = disk.find(item => item.id === id);
    if (!chapter) return;
    const key = keyOf(id, pane);
    setDrafts(current => {
      const previous = current[key];
      if (!previous && source === chapter[pane]) return current;
      return { ...current, [key]: previous ? { ...previous, source }
        : { id, pane, source, base: chapter[pane], status: 'pending' } };
    });
  }

  function discard(draft: Draft) {
    if (draft.status === 'saving' || !window.confirm('放弃这份网页草稿，采用磁盘上的内容？')) return;
    setDrafts(current => {
      const next = { ...current };
      delete next[keyOf(draft.id, draft.pane)];
      return next;
    });
  }

  function retry(draft: Draft) {
    setDrafts(current => ({ ...current, [keyOf(draft.id, draft.pane)]: { ...draft, status: 'pending', error: undefined } }));
  }

  const chapters = disk.map(item => role === 'student' ? item : {
    ...item,
    tutorial: drafts[keyOf(item.id, 'tutorial')]?.source ?? item.tutorial,
    notes: drafts[keyOf(item.id, 'notes')]?.source ?? item.notes,
  });
  return { chapters, activeId, setActiveId, edit, unsaved, discard, retry, connectionError };
}
