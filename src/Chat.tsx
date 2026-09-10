import { useEffect, useRef, useState } from 'react';

export type ChatContext = {
  id: string;
  title: string;
  pane: 'tutorial' | 'notes';
  source: string;
  line: number;
  selection: string;
};
type Model = { provider: string; id: string; name: string; thinkingLevels: string[] };
type Request = { text: string; context: ChatContext; provider: string; model: string; thinking: string };
type Message = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  context: string;
  error?: boolean;
  retry?: Request;
  proposal?: { context: ChatContext; source: string };
  applied?: boolean;
  code?: boolean;
};

function contextLabel(context: ChatContext) {
  return `${context.title} · ${context.pane === 'tutorial' ? '课件' : '笔记'} L${context.line}`;
}

export function Chat({ context, readOnly, onApply, onClearSelection }: {
  context: ChatContext;
  readOnly: boolean;
  onApply: (context: ChatContext, source: string) => string | undefined;
  onClearSelection: () => void;
}) {
  const [models, setModels] = useState<Model[]>([]);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState('off');
  const [modelError, setModelError] = useState('');
  const [modelAttempt, setModelAttempt] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [unread, setUnread] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const nextId = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const follow = useRef(true);
  const providers = [...new Set(models.map(item => item.provider))];
  const modelChoices = models.filter(item => item.provider === provider);
  const selectedModel = modelChoices.find(item => item.id === model);
  const thinkingChoices = selectedModel?.thinkingLevels ?? ['off'];
  const isCode = /^\/(julia|r)(?:\s|$)/.test(draft.trim());

  useEffect(() => {
    const controller = new AbortController();
    setModelError('');
    fetch('/api/models', { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '模型加载失败');
        if (controller.signal.aborted) return;
        const available: Model[] = data.models;
        const initial = available.find(item =>
          item.provider === data.defaultModel?.provider && item.id === data.defaultModel?.id,
        ) ?? available[0];
        if (!initial) throw new Error('没有可用模型');
        setModels(available);
        setProvider(initial.provider);
        setModel(initial.id);
        setThinking(initial.thinkingLevels.includes(data.defaultThinkingLevel)
          ? data.defaultThinkingLevel : initial.thinkingLevels[0] ?? 'off');
      })
      .catch(error => {
        if (!controller.signal.aborted) setModelError(error.message);
      });
    return () => controller.abort();
  }, [modelAttempt]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (follow.current && list.current) list.current.scrollTop = list.current.scrollHeight;
    else setUnread(true);
  }, [messages, busy]);

  function chooseModel(next: Model) {
    setProvider(next.provider);
    setModel(next.id);
    setThinking(next.thinkingLevels.includes(thinking) ? thinking : next.thinkingLevels[0] ?? 'off');
  }

  async function send(retry?: Request) {
    const text = (retry?.text ?? draft).trim();
    if (!text || requestRef.current || readOnly) return;
    const request = retry ?? { text, context: { ...context }, provider, model, thinking };
    const command = text.match(/^\/(julia|r)(?:\s|$)/);
    if (!command && !models.some(item => item.provider === request.provider && item.id === request.model)) {
      setNotice('请先选择可用模型。');
      return;
    }
    const code = request.context.selection || text.slice(command?.[0].length ?? 0).trim();
    if (command && !code.trim()) {
      setNotice('请选中代码，或在命令后输入代码。');
      input.current?.focus();
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setNotice('');
    if (!retry) setDraft('');
    follow.current = true;
    setUnread(false);
    const label = contextLabel(request.context);
    setMessages(cur => [...cur, { id: nextId.current++, role: 'user', text, context: label }]);
    try {
      const response = await fetch(command ? '/api/run' : '/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(command ? { lang: command[1], code } : {
          source: request.context.source,
          instruction: `${text}\n\n[${label}${request.context.selection ? ' 选区' : ''}]\n${request.context.selection}`,
          provider: request.provider,
          model: request.model,
          thinkingLevel: request.thinking,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `请求失败（${response.status}）`);
      if (controller.signal.aborted) return;
      if (!command && (typeof result.source !== 'string' || !result.source.trim())) {
        throw new Error('模型未返回有效源码，未修改文档。');
      }
      const failed = command && result.status !== 0;
      setMessages(cur => [...cur, {
        id: nextId.current++, role: 'assistant', context: label,
        text: command
          ? [result.stdout, result.stderr, failed ? `退出码：${result.status}` : ''].filter(Boolean).join('\n') || '(无输出)'
          : result.source === request.context.source ? '内容无需修改。' : '修改已生成，请检查源码后应用。',
        code: !!command,
        error: !!failed,
        retry: failed ? request : undefined,
        proposal: !command && result.source !== request.context.source
          ? { context: request.context, source: result.source } : undefined,
      }]);
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessages(cur => [...cur, {
          id: nextId.current++, role: 'assistant', context: label,
          text: error instanceof Error ? error.message : String(error), error: true, retry: request,
        }]);
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setBusy(false);
      }
    }
  }

  function stop() {
    requestRef.current?.abort();
    requestRef.current = null;
    setBusy(false);
    setNotice('已停止等待，不会应用结果；服务端任务可能仍在运行。');
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('已复制。');
    } catch {
      setNotice('复制失败，请手动选择文本复制。');
    }
  }

  return (
    <aside className="chat" aria-label="Pi 课堂助手">
      <header className="chat-header">
        <div className="chat-brand">
          <span className="chat-logo" aria-hidden="true">π</span>
          <div><strong>Pi 课堂助手</strong><small>让想法成为课件</small></div>
        </div>
        <button className="chat-subtle" disabled={busy || !messages.length} onClick={() => {
          if (!window.confirm('清空聊天记录？已应用的文档修改会保留。')) return;
          setMessages([]);
          setNotice('');
          setUnread(false);
        }}>清空</button>
      </header>

      <details className="chat-settings">
        <summary><span className={`chat-dot${modelError ? ' offline' : ''}`} />
          <span>{selectedModel?.name ?? (modelError ? '模型不可用' : '正在连接模型…')}</span>
          <span className="chat-settings-label">模型设置</span>
        </summary>
        <div className="pickers">
          <label>服务商<select aria-label="服务商" value={provider} disabled={!models.length || busy}
            onChange={event => chooseModel(models.find(item => item.provider === event.target.value)!)}>
            {providers.map(item => <option key={item}>{item}</option>)}
          </select></label>
          <label>模型<select aria-label="模型" value={model} disabled={!models.length || busy}
            onChange={event => chooseModel(modelChoices.find(item => item.id === event.target.value)!)}>
            {modelChoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>思考强度<select aria-label="思考强度" value={thinking} disabled={!models.length || busy}
            onChange={event => setThinking(event.target.value)}>
            {thinkingChoices.map(item => <option key={item}>{item}</option>)}
          </select></label>
        </div>
      </details>
      {modelError && <div className="chat-warning" role="alert">{modelError}
        <button className="chat-subtle" onClick={() => setModelAttempt(value => value + 1)}>重新连接</button>
      </div>}

      <div className="messages" ref={list} role="log" aria-label="聊天记录" aria-live="polite"
        aria-busy={busy} onScroll={event => {
          const el = event.currentTarget;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (follow.current) setUnread(false);
        }}>
        {!messages.length && <div className="chat-welcome">
          <span className="chat-welcome-mark" aria-hidden="true">✦</span>
          <h2>一起完善这堂课</h2>
          <p>在编辑模式选中文本，<br />告诉我你想怎样修改课件或笔记。</p>
          <div className="chat-suggestions">
            {['润色表述，保留原意', '补充一个例题与解题步骤', '整理结构，突出关键结论'].map(text => (
              <button key={text} disabled={readOnly} onClick={() => {
                setDraft(text);
                input.current?.focus();
              }}><span>{text}</span><span aria-hidden="true">↗</span></button>
            ))}
          </div>
          <small>每次请求携带当前文档，不携带聊天历史。<br />修改先预览，确认后才写入。</small>
        </div>}
        {messages.map(item => <article key={item.id} className={`msg ${item.role}${item.error ? ' error' : ''}`}>
          <div className="msg-meta"><strong>{item.role === 'user' ? '你' : 'Pi'}</strong>
            <span>{item.error ? '未完成' : item.role === 'user' ? '修改请求' : '课堂助手'}</span>
          </div>
          <small className="msg-context">{item.context}</small>
          {item.code ? <pre className="msg-code">{item.text}</pre> : <div className="msg-text">{item.text}</div>}
          {item.proposal && <details className="chat-proposal">
            <summary>查看修改后的 Typst 源码</summary>
            <pre>{item.proposal.source}</pre>
          </details>}
          <div className="msg-actions">
            <button className="chat-subtle" onClick={() => copy(item.proposal?.source ?? item.text)}>复制{item.proposal ? '源码' : ''}</button>
            {item.retry && <button className="chat-subtle" disabled={busy || readOnly}
              title="使用原请求的文档、选区及模型重试" onClick={() => send(item.retry)}>重试</button>}
            {item.proposal && <button className="chat-apply" disabled={item.applied || readOnly || busy} onClick={() => {
              const proposal = item.proposal!;
              const error = onApply(proposal.context, proposal.source);
              setNotice(error || '已应用到编辑器。');
              if (!error) setMessages(cur => cur.map(message => message.id === item.id ? { ...message, applied: true } : message));
            }}>{item.applied ? '已应用' : '应用修改'}</button>}
          </div>
        </article>)}
        {busy && <div className="chat-working" role="status"><span className="chat-dot" />正在处理，请稍候…</div>}
      </div>
      {unread && <button className="chat-latest" onClick={() => {
        follow.current = true;
        setUnread(false);
        if (list.current) list.current.scrollTop = list.current.scrollHeight;
      }}>↓ 查看最新消息</button>}

      <div className="chat-bottom">
        <div className="chat-context">
          <span className="chat-context-icon" aria-hidden="true">⌘</span>
          <div><strong title={contextLabel(context)}>{contextLabel(context)}</strong>
            <small>{context.selection ? `已选择 ${context.selection.length} 字` : '携带当前文档全文'}</small>
          </div>
          {context.selection && <button className="chat-subtle" aria-label="清除选区" onClick={onClearSelection}>×</button>}
        </div>
        {context.selection && <pre className="chat-selection">{context.selection}</pre>}
        <form className="chat-composer" onSubmit={event => { event.preventDefault(); send(); }}>
          <textarea ref={input} aria-label="消息" value={draft} rows={3} maxLength={6000} disabled={readOnly}
            placeholder={readOnly ? '学生模式下仅可查看' : '描述修改，或输入 /julia、/r 运行代码…'}
            onChange={event => setDraft(event.target.value)} onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                send();
              }
            }} />
          <div className="chat-composer-actions">
            <div className="chat-commands">
              {['/julia', '/r'].map(command => <button type="button" key={command} disabled={readOnly || busy}
                title={`运行${context.selection ? '选区中的' : '输入的'}代码（会在服务器执行）`} onClick={() => {
                  setDraft(`${command} `);
                  input.current?.focus();
                }}>{command}</button>)}
            </div>
            {busy ? <button type="button" className="chat-send" onClick={stop}>停止等待</button>
              : <button className="chat-send" type="submit" disabled={!draft.trim() || readOnly || (!isCode && !selectedModel)}>
                发送 <span aria-hidden="true">↑</span>
              </button>}
          </div>
        </form>
        <div className="chat-hint">{isCode ? '代码在服务器执行，请勿运行不可信代码' : 'Enter 发送 · Shift + Enter 换行'}</div>
        <div className="chat-notice" role="status">{notice}</div>
      </div>
    </aside>
  );
}
