import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Chat } from './Chat';
import { embedVideos } from './embed';
import { renderSvg } from './typst';
import { useDocuments, type Pane } from './useDocuments';
type Mode = 'preview' | 'edit';
type Role = 'teacher' | 'student';

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

function Preview({ source, dir }: { source: string; dir: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('正在编译…');
  useEffect(() => {
    let gone = false;
    const timer = setTimeout(() => {
      renderSvg(source, dir)
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
  }, [source, dir]);
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
  dir,
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
  dir: string;
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
      {mode === 'preview' ? <Preview source={source} dir={dir} /> : (
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

function Simulation({ onClose, role }: { onClose: () => void; role: Role }) {
  const [mode, setMode] = useState<'edit' | 'run'>(role === 'teacher' ? 'edit' : 'run');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setUrl('');
    setError('');
    fetch(mode === 'edit' ? '/api/pluto' : '/api/pluto-slider')
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (active) setUrl(data.url);
      })
      .catch(error => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [mode]);

  return (
    <section className="simulation">
      <header>
        <strong>Julia 仿真</strong>
        <span className="tabs">
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
            创作
          </button>
          <button className={mode === 'run' ? 'on' : ''} onClick={() => setMode('run')}>
            交互
          </button>
        </span>
        <span className="simulation-actions">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer">
              新窗口
            </a>
          ) : null}
          <button onClick={onClose}>返回课程</button>
        </span>
      </header>
      {error ? (
        <pre className="status">启动失败：{error}</pre>
      ) : url ? (
        <iframe title={mode === 'edit' ? 'Pluto.jl' : 'PlutoSliderServer'} src={url} allow="fullscreen" />
      ) : (
        <pre className="status">正在启动{mode === 'edit' ? ' Pluto' : '交互服务'}…</pre>
      )}
    </section>
  );
}

export function App() {
  const [modes, setModes] = useState<Record<Pane, Mode>>({ tutorial: 'preview', notes: 'edit' });
  const [focus, setFocus] = useState({ pane: 'tutorial' as Pane, line: 1, selection: '' });
  const [role, setRole] = useState<Role>('teacher');
  const { chapters, activeId, setActiveId, edit, unsaved, discard, retry, connectionError } = useDocuments(role);
  const [simulation, setSimulation] = useState(false);
  const appRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(200);
  const [mid, setMid] = useState([1, 1]);
  const [chatW, setChatW] = useState(380);

  const chapter = chapters.find(item => item.id === activeId) ?? chapters[0];

  useEffect(() => {
    setFocus(cur => ({ ...cur, line: 1, selection: '' }));
  }, [chapter?.id]);

  const setDoc = (pane: Pane, source: string) => edit(chapter.id, pane, source);

  const syncStatus = (
    <div className="sync-status" aria-live="polite">
      {connectionError && <p role="alert">{connectionError}</p>}
      {unsaved.map(draft => (
        <div key={`${draft.id}/${draft.pane}`}>
          <strong>{draft.id} · {draft.pane === 'tutorial' ? '课件' : '笔记'}</strong>
          <p>{draft.error || (draft.status === 'saving' ? '正在保存…' : '有未保存修改')}</p>
          {draft.status === 'error' && <>
            <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(draft.source)}`}
              download={`${draft.id}-${draft.pane}.typ`}>下载网页草稿</a>
            <button disabled={role !== 'teacher'} onClick={() => retry(draft)}>重试保存</button>
            <button onClick={() => discard(draft)}>放弃网页修改</button>
          </>}
        </div>
      ))}
    </div>
  );

  const focusDoc = (pane: Pane, loc?: { line: number; selection: string }) => {
    setFocus(cur => ({ pane, line: loc?.line ?? (cur.pane === pane ? cur.line : 1), selection: loc?.selection ?? '' }));
  };

  if (!chapter) {
    return (
      <div className="app">
        <aside className="sidebar">
          <h1>Typst 课堂</h1>
          <nav>
            <button onClick={() => setSimulation(true)}>Julia 仿真</button>
          </nav>
          {syncStatus}
          <p className="status">在 content/ 下新建章节文件夹，放入 课件.typ 与 笔记.typ。</p>
        </aside>
        {simulation ? <Simulation role={role} onClose={() => setSimulation(false)} /> : null}
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
          <button onClick={() => setSimulation(true)}>Julia 仿真</button>
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
        {syncStatus}
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
        dir={chapter.id}
        mode={modes.tutorial}
        focused={focus.pane === 'tutorial'}
        readOnly={role === 'student'}
        onMode={mode => setModes(cur => ({ ...cur, tutorial: mode }))}
        onChange={source => setDoc('tutorial', source)}
        onFocus={focusDoc}
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
        dir={chapter.id}
        mode={modes.notes}
        focused={focus.pane === 'notes'}
        readOnly={role === 'student'}
        onMode={mode => setModes(cur => ({ ...cur, notes: mode }))}
        onChange={source => setDoc('notes', source)}
        onFocus={focusDoc}
      />
      <div
        className="split"
        onPointerDown={e => {
          const c0 = chatW;
          drag(e, dx => setChatW(Math.min(640, Math.max(300, c0 - dx))));
        }}
      />
      <Chat
        context={{ id: chapter.id, title: chapter.title, source: chapter[focus.pane], ...focus }}
        readOnly={role === 'student'}
        onClearSelection={() => setFocus(cur => ({ ...cur, selection: '' }))}
        onApply={(target, source) => {
          if (role !== 'teacher') return '学生模式不能修改文档。';
          if (chapter.id !== target.id) return '请切回原章节后应用修改。';
          if (chapter[target.pane] !== target.source) return '文档已发生变化，请基于最新内容重新发送，避免覆盖。';
          setDoc(target.pane, source);
          setFocus(cur => ({ ...cur, selection: '' }));
          return undefined;
        }}
      />
      {simulation ? <Simulation role={role} onClose={() => setSimulation(false)} /> : null}
    </div>
  );
}
