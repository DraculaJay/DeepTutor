"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiUrl } from "@/lib/api";
import "./note-perception.css";

type PerceptionStatus = {
  connected: boolean; capture_ready: boolean; system_audio_ready?: boolean; error: string;
  context?: {
    capture_source?: { id: number; label: string };
    session_id: string; note_document_id?: string; note_title?: string;
    timestamp?: string; context_synced_at?: string; native_context_revision?: number;
    latest_observation?: string; recent_transcript?: string;
    learning_context?: { question?: string; answer?: string };
    course?: { title: string; status: string; output_path?: string };
  };
};

export default function NotePerception({ pageId, flush, onAsk, onSuggestions }: {
  pageId: string; flush: () => Promise<void>; onAsk: (prompt: string) => void;
  onSuggestions: () => void;
}) {
  const [status, setStatus] = useState<PerceptionStatus | null>(null);
  const [sources, setSources] = useState<{ id: number; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await apiFetch(apiUrl("/api/deskmate/status"), { cache: "no-store" });
    if (!response.ok) throw new Error("感知状态读取失败，请检查本地服务。");
    return await response.json() as PerceptionStatus;
  }, []);
  useEffect(() => {
    let active = true;
    const poll = () => void refresh().then(value => { if (active) setStatus(value); })
      .catch(reason => { if (active) setError(String(reason)); });
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [pageId, refresh]);
  const owned = status?.context?.note_document_id === pageId;
  const connected = Boolean(status?.connected && owned);
  const elsewhere = Boolean(status?.connected && !owned);
  const loadSources = useCallback(async () => {
    const response = await apiFetch(apiUrl("/api/deskmate/capture/sources"), { cache: "no-store" });
    const value = await response.json();
    if (!response.ok) throw new Error(value.detail || "窗口列表读取失败");
    setSources(value.sources);
  }, []);
  useEffect(() => {
    if (connected) void loadSources().catch(reason => setError(String(reason)));
    else setSources([]);
  }, [connected, pageId, loadSources]);
  const selectSource = async (windowId: number) => {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(apiUrl("/api/deskmate/capture/source"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_document_id: pageId, window_id: windowId }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.detail || "窗口切换失败");
      setStatus(value);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const act = async (action: "start" | "stop" | "context" | "course/finish") => {
    setBusy(true); setError("");
    try {
      if (action === "start" || action === "context") await flush();
      const response = await apiFetch(apiUrl(`/api/deskmate/${action}`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: action === "start" || action === "context" ? JSON.stringify({ note_document_id: pageId }) : undefined,
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.detail || "感知操作失败");
      setStatus(await refresh());
      onSuggestions();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const ask = async (prompt: string) => {
    try {
      await flush();
      onAsk(prompt);
    } catch (reason) { setError(String(reason)); }
  };
  const context = owned ? status?.context : undefined;
  const visibleSources = sources.filter(source => source.id === 0 || source.label.includes(" — "));
  return <section className="dt-note-perception" aria-label="同桌感知">
    <div className="dt-note-perception-bar">
      <span className={`dt-note-perception-dot ${connected && status?.capture_ready ? "is-active" : ""}`} />
      <strong>同桌感知</strong>
      <span className="dt-note-perception-state">{busy ? "正在处理…" : connected ? status?.capture_ready ? "感知中 · 当前笔记" : "正在准备采集" : elsewhere ? "正在另一处学习" : "已停止"}</span>
      <label className="dt-note-perception-source">感知范围
        <select aria-label="选择感知窗口" disabled={busy || !connected || !status?.capture_ready}
          value={context?.capture_source?.id ?? 0} onChange={event => void selectSource(Number(event.target.value))}>
          <option value={0}>{connected ? "整个屏幕" : "启动后选择窗口"}</option>
          {visibleSources.filter(source => source.id !== 0).map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
          {context?.capture_source?.id && !visibleSources.some(source => source.id === context.capture_source?.id)
            ? <option value={context.capture_source.id}>{context.capture_source.label}（请刷新确认窗口）</option> : null}
        </select>
        {connected && <button disabled={busy} onClick={() => void loadSources().catch(reason => setError(String(reason)))}>刷新窗口</button>}
      </label>
      <div className="dt-note-perception-actions">
        {!connected && !elsewhere && <button disabled={busy} onClick={() => void act("start")}>启动感知</button>}
        {connected && <>
          <button disabled={busy} onClick={() => void act("context")}>同步笔记</button>
          <button disabled={busy || !status?.capture_ready} onClick={() => void ask("请结合当前笔记和最新屏幕观察，解释我正在学习的内容。没有可靠证据时请明确说明。")}>问当前画面</button>
          <button disabled={busy || !status?.capture_ready} onClick={() => void ask("请把当前感知到的学习内容整理为带来源和采集时间的过程笔记建议。只记录有证据的内容，保留我的正文，等我接受后再应用。")}>整理成笔记</button>
          <button disabled={busy} onClick={() => void act("stop")}>停止</button>
        </>}
        {elsewhere && <button disabled={busy} onClick={() => void act("stop")}>停止上一处感知</button>}
      </div>
    </div>
    {elsewhere && <p>当前感知不会混入这份笔记。{status?.context?.note_document_id && <Link href={`/co-writer/${status.context.note_document_id}`}>返回正在学习的笔记</Link>}</p>}
    {connected && <details className="dt-note-perception-details">
      <summary>{context?.latest_observation || "正在等待屏幕观察；首次使用请允许屏幕与系统音频录制。"}</summary>
      <p>感知范围：{context?.capture_source?.label || "整个屏幕"}。选择窗口后，切回笔记也会继续捕捉该窗口；系统音频仍来自电脑输出。</p>
      <p>系统音频：{status?.system_audio_ready ? "已收到音频流" : "等待电脑播放声音"} · 笔记上下文：{context?.context_synced_at ? "已同步" : "待同步"}</p>
      <p>启动和提问时会同步已保存的笔记及当前问答；编辑后也可点击“同步笔记”。感知不会覆盖正文。</p>
      {context?.learning_context?.question && <p>当前关注：{context.learning_context.question}</p>}
      {context?.recent_transcript && <pre>{context.recent_transcript}</pre>}
      {context?.course && <p>课程：{context.course.title} · {context.course.status} <button disabled={busy} onClick={() => void act("course/finish")}>结束课程 / 重试总结</button></p>}
      {context?.course?.output_path && <Link href={`/co-writer/${context.course.output_path}`}>查看课程总结笔记</Link>}
    </details>}
    {(error || (owned && status?.error)) && <p role="alert" className="dt-note-perception-error">{error || status?.error}</p>}
  </section>;
}
