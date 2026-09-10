import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { embedVideos } from './embed';
import { renderSvg } from './typst';

type Pane = 'tutorial' | 'notes';
type Mode = 'preview' | 'edit';
type Role = 'teacher' | 'student';
type Model = { provider: string; id: string; name: string; thinkingLevels: string[] };
type Chapter = { id: string; title: string; tutorial: string; notes: string };
type Live = { activeId: string; chapters: Chapter[] };

function lineAt(source: string, offset: number) {
  return source.slice(0, offset).split('\n').length;
}

function drag(e: ReactPointerEvent<HTMLElement>, apply: (dx: number) => void) {
  e.preventDefault();
  const x0 = e.clientX;
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => apply(ev.clientX - x0);
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
}

function esc(s: string) {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
}

const TOK =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|```[\s\S]*?```|`[^`]*`|\$[^$]*\$|"[^"\\]*(?:\\.[^"\\]*)*"|#[a-zA-Z_][\w-]*|<[\w-:.]+>|^[ \t]*=+[^\n]*/gm;

function highlight(src: string) {
  let out = '';
  let i = 0;
  for (const m of src.matchAll(TOK)) {
    const t = m[0];
    const at = m.index!;
    out += esc(src.slice(i, at));
    const cls = t.startsWith('//') || t.startsWith('/*') ? 'c'
      : t.startsWith('`') ? 'raw'
      : t.startsWith('$') ? 'math'
      : t.startsWith('"') ? 's'
      : t.startsWith('#') ? 'fn'
      : t.startsWith('<') ? 'lab'
      : 'h';
    out += `<span class="${cls}">${esc(t)}</span>`;
    i = at + t.length;
  }
  return out + esc(src.slice(i));
}

function Preview({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('正在编译…');
  useEffect(() => {
    let gone = false;
    const timer = setTimeout(() => {
      renderSvg(source)
        .then(svg => {
          if (gone || !ref.current) return;
          setStatus('');
          ref.current.innerHTML = svg;
          embedVideos(ref.current);
        })
        .catch(error => {
          if (!gone) setStatus(`编译失败：${error}`);
        });
    }, 280);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [source]);
  return (
    <div className="preview">
      {status ? <pre className="status">{status}</pre> : null}
      <div ref={ref} />
    </div>
  );
}

function Editor({
  value,
  readOnly,
  onChange,
  onSelect,
}: {
  value: string;
  readOnly: boolean;
  onChange: (source: string) => void;
  onSelect: (line: number, selection: string) => void;
}) {
  const gutter = useRef<HTMLPreElement>(null);
  const hl = useRef<HTMLPreElement>(null);
  const n = value.split('\n').length;
  const sync = (el: HTMLTextAreaElement) => {
    if (gutter.current) gutter.current.scrollTop = el.scrollTop;
    if (hl.current) {
      hl.current.scrollTop = el.scrollTop;
      hl.current.scrollLeft = el.scrollLeft;
    }
  };
  return (
    <div className="editor">
      <pre className="gutter" ref={gutter}>{Array.from({ length: n }, (_, i) => i + 1).join('\n')}</pre>
      <div className="code">
        <pre className="hl" ref={hl} dangerouslySetInnerHTML={{ __html: highlight(value) }} />
        <textarea
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          onScroll={e => sync(e.currentTarget)}
          onSelect={e => {
            const el = e.currentTarget;
            onSelect(lineAt(el.value, el.selectionStart), el.value.slice(el.selectionStart, el.selectionEnd));
          }}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function DocPane({
  title,
  pane,
  source,
  mode,
  focused,
  readOnly,
  onMode,
  onChange,
  onFocus,
}: {
  title: string;
  pane: Pane;
  source: string;
  mode: Mode;
  focused: boolean;
  readOnly: boolean;
  onMode: (mode: Mode) => void;
  onChange: (source: string) => void;
  onFocus: (pane: Pane, loc?: { line: number; selection: string }) => void;
}) {
  return (
    <section className={`pane${focused ? ' focused' : ''}`} onMouseDown={() => onFocus(pane)}>
      <header>
        <strong>{title}</strong>
        <span className="tabs">
          {(['preview', 'edit'] as const).map(item => (
            <button key={item} className={mode === item ? 'on' : ''} onClick={() => onMode(item)}>
              {item === 'preview' ? '预览' : '编辑'}
            </button>
          ))}
        </span>
      </header>
      {mode === 'preview' ? <Preview source={source} /> : (
        <Editor
          value={source}
          readOnly={readOnly}
          onChange={onChange}
          onSelect={(line, selection) => onFocus(pane, { line, selection })}
        />
      )}
    </section>
  );
}

export function App() {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeId, setActiveId] = useState('');
  const [modes, setModes] = useState<Record<Pane, Mode>>({ tutorial: 'preview', notes: 'edit' });
  const [focus, setFocus] = useState({ pane: 'tutorial' as Pane, line: 1, selection: '' });
  const [role, setRole] = useState<Role>('teacher');
  const [models, setModels] = useState<Model[]>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState('off');
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([
    { role: 'assistant', text: '单击课件或笔记，选中文本后发送。/julia 或 /r 可跑选区代码。' },
  ]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const skipSave = useRef(true);
  const appRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(200);
  const [mid, setMid] = useState([1, 1]);
  const [chatW, setChatW] = useState(340);

  const chapter = chapters.find(item => item.id === activeId) ?? chapters[0];
  const providers = useMemo(() => [...new Set(models.map(item => item.provider))], [models]);
  const modelChoices = models.filter(item => item.provider === provider);
  const thinkingChoices =
    modelChoices.find(item => item.id === model)?.thinkingLevels ?? ['off'];

  useEffect(() => {
    fetch('/api/models')
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setModels(data.models);
        setProvider(data.defaultModel.provider);
        setModel(data.defaultModel.id);
        setThinking(data.defaultThinkingLevel);
      })
      .catch(error => setMessages(cur => [...cur, { role: 'assistant', text: String(error) }]));
    fetch('/api/chapters')
      .then(async response => {
        const data = (await response.json()) as Live;
        skipSave.current = true;
        setChapters(data.chapters);
        setActiveId(data.activeId || data.chapters[0]?.id || '');
      })
      .catch(error => setMessages(cur => [...cur, { role: 'assistant', text: String(error) }]));
  }, []);

  useEffect(() => {
    if (role !== 'teacher' || !chapter) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const timer = setTimeout(() => {
      fetch('/api/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: chapter.id,
          tutorial: chapter.tutorial,
          notes: chapter.notes,
        }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [role, chapter?.id, chapter?.tutorial, chapter?.notes]);

  useEffect(() => {
    if (role !== 'teacher' || !activeId) return;
    fetch('/api/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeId }),
    }).catch(() => {});
  }, [role, activeId]);

  useEffect(() => {
    if (role !== 'student') return;
    const source = new EventSource('/api/live');
    source.onmessage = event => {
      const live = JSON.parse(event.data) as Live;
      setChapters(live.chapters);
      setActiveId(live.activeId);
    };
    return () => source.close();
  }, [role]);

  const setDoc = (pane: Pane, source: string) => {
    if (role === 'student') return;
    setChapters(cur =>
      cur.map(item => (item.id === chapter.id ? { ...item, [pane]: source } : item)),
    );
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setMessages(cur => [...cur, { role: 'user', text }]);
    setBusy(true);
    const source = chapter[focus.pane];
    const ctx = `${focus.pane === 'tutorial' ? '课件' : '笔记'} L${focus.line}`;
    try {
      if (text.startsWith('/julia') || text.startsWith('/r')) {
        const lang = text.startsWith('/julia') ? 'julia' : 'r';
        const code = focus.selection || text.replace(/^\/julia\s*|^\/r\s*/, '');
        const response = await fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lang, code }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setMessages(cur => [
          ...cur,
          { role: 'assistant', text: result.stdout || result.stderr || '(无输出)' },
        ]);
        return;
      }
      const instruction = focus.selection
        ? `${text}\n\n[${ctx} 选区]\n${focus.selection}`
        : `${text}\n\n[${ctx}]`;
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          instruction,
          provider,
          model,
          thinkingLevel: thinking,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDoc(focus.pane, result.source);
      setMessages(cur => [...cur, { role: 'assistant', text: `已修改${ctx}。` }]);
    } catch (error) {
      setMessages(cur => [...cur, { role: 'assistant', text: `失败：${error}` }]);
    } finally {
      setBusy(false);
    }
  };

  if (!chapter) {
    return (
      <div className="app">
        <aside className="sidebar">
          <h1>Typst 课堂</h1>
          <p className="status">在 content/ 下新建章节文件夹，放入 课件.typ 与 笔记.typ 后刷新。</p>
        </aside>
      </div>
    );
  }

  return (
    <div
      className="app"
      ref={appRef}
      style={{
        gridTemplateColumns: `${side}px 5px minmax(0, ${mid[0]}fr) 5px minmax(0, ${mid[1]}fr) 5px ${chatW}px`,
      }}
    >
      <aside className="sidebar">
        <h1>Typst 课堂</h1>
        <div className="tabs">
          {(['teacher', 'student'] as const).map(item => (
            <button key={item} className={role === item ? 'on' : ''} onClick={() => setRole(item)}>
              {item === 'teacher' ? '教师' : '学生'}
            </button>
          ))}
        </div>
        <nav>
          {chapters.map(item => (
            <button
              key={item.id}
              className={item.id === chapter.id ? 'on' : ''}
              onClick={() => setActiveId(item.id)}
            >
              {item.title}
            </button>
          ))}
        </nav>
      </aside>
      <div
        className="split"
        onPointerDown={e => {
          const s0 = side;
          drag(e, dx => setSide(Math.max(140, s0 + dx)));
        }}
      />
      <DocPane
        title="课件"
        pane="tutorial"
        source={chapter.tutorial}
        mode={modes.tutorial}
        focused={focus.pane === 'tutorial'}
        readOnly={role === 'student'}
        onMode={mode => setModes(cur => ({ ...cur, tutorial: mode }))}
        onChange={source => setDoc('tutorial', source)}
        onFocus={(pane, loc) => setFocus(cur => ({ pane, line: loc?.line ?? cur.line, selection: loc?.selection ?? '' }))}
      />
      <div
        className="split"
        onPointerDown={e => {
          const panes = appRef.current?.querySelectorAll('.pane');
          if (!panes || panes.length < 2) return;
          const a0 = panes[0].clientWidth;
          const b0 = panes[1].clientWidth;
          drag(e, dx => setMid([Math.max(160, a0 + dx), Math.max(160, b0 - dx)]));
        }}
      />
      <DocPane
        title="笔记"
        pane="notes"
        source={chapter.notes}
        mode={modes.notes}
        focused={focus.pane === 'notes'}
        readOnly={role === 'student'}
        onMode={mode => setModes(cur => ({ ...cur, notes: mode }))}
        onChange={source => setDoc('notes', source)}
        onFocus={(pane, loc) => setFocus(cur => ({ pane, line: loc?.line ?? cur.line, selection: loc?.selection ?? '' }))}
      />
      <div
        className="split"
        onPointerDown={e => {
          const c0 = chatW;
          drag(e, dx => setChatW(Math.max(240, c0 - dx)));
        }}
      />
      <aside className="chat">
        <header>
          <strong>Pi Chat</strong>
          <span className="ctx">
            {focus.pane === 'tutorial' ? '课件' : '笔记'} L{focus.line}
            {focus.selection ? ` · ${focus.selection.length} 字` : ''}
          </span>
        </header>
        <div className="pickers">
          <select value={provider} onChange={event => setProvider(event.target.value)}>
            {providers.map(item => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select value={model} onChange={event => setModel(event.target.value)}>
            {modelChoices.map(item => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select value={thinking} onChange={event => setThinking(event.target.value)}>
            {thinkingChoices.map(item => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="messages">
          {messages.map((item, index) => (
            <div key={index} className={`msg ${item.role}`}>
              {item.text}
            </div>
          ))}
        </div>
        <textarea
          value={draft}
          rows={3}
          placeholder="发送修改，或 /julia /r"
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button disabled={busy} onClick={send}>
          {busy ? '…' : '发送'}
        </button>
      </aside>
    </div>
  );
}
