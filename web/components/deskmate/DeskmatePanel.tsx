"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { apiFetch } from "@/shared/api/client";

type Status = {
  connected: boolean; capture_ready: boolean; system_audio_ready?: boolean; state: string; error: string;
  context?: { session_id: string; scene: string; latest_observation: string; recent_transcript: string;
    foreground_application: { name?: string }; course?: { title: string; status: string; output_path?: string } };
  messages?: string[];
};

export default function DeskmatePanel() {
  const path = usePathname();
  const params = useParams<{ sessionId?: string }>();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = path.startsWith("/chat");
  useEffect(() => {
    if (!visible || !open) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await apiFetch("/api/deskmate/status");
        if (!response.ok) throw new Error(`状态读取失败 (${response.status})`);
        const value: Status = await response.json();
        if (active) setStatus(value);
      } catch (e) { if (active) setError(String(e)); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => { active = false; clearInterval(timer); };
  }, [visible, open]);
  if (!visible) return null;
  const action = async (name: string) => {
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/deskmate/${name}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: name === "start" ? JSON.stringify({ session_id: params.sessionId }) : undefined,
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.detail || "操作失败");
      const state = await apiFetch("/api/deskmate/status");
      if (state.ok) setStatus(await state.json());
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <aside className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-[var(--background)] p-3 text-sm shadow-md" aria-label="AI Deskmate">
    <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>AI Deskmate {status?.capture_ready ? "· 感知中" : ""}</button>
    {open && <div className="mt-2 flex flex-col gap-2">
      <p>屏幕和系统音频会交给 DeepTutor 当前配置的视觉模型与语音转写服务。麦克风提问沿用聊天框。</p>
      {!params.sessionId && <p>先在学习对话中发送一条消息，建立会话。</p>}
      <div className="flex gap-3">
        <button disabled={busy || !params.sessionId || !!status?.connected} onClick={() => void action("start")}>启动感知</button>
        <button disabled={busy || !status?.connected} onClick={() => void action("stop")}>停止</button>
        <button disabled={busy || !status?.context?.course} onClick={() => void action("course/finish")}>结束课程 / 重试总结</button>
      </div>
      <p>状态：{status?.capture_ready ? "采集中" : status?.connected ? "等待采集授权" : "已停止"} · 场景：{status?.context?.scene || "—"}</p>
      {status?.connected && <p>系统音频：{status.system_audio_ready ? "已收到音频流" : "等待系统播放音频"}</p>}
      <p>前台：{status?.context?.foreground_application?.name || "—"} · 课程：{status?.context?.course?.title || "—"}</p>
      {status?.context?.course && <p>课程状态：{status.context.course.status}</p>}
      {status?.context?.course?.output_path && <a className="underline" href={`/co-writer/${status.context.course.output_path}`}>查看课程总结笔记</a>}
      {status?.context?.recent_transcript && <details><summary>最近课程转写</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{status.context.recent_transcript}</pre></details>}
      {status?.context?.latest_observation && <p>{status.context.latest_observation}</p>}
      {status?.messages?.map((message, index) => <p key={index} role="status">{message}</p>)}
      <p>首次使用请在系统设置 → 隐私与安全性中允许屏幕与系统音频录制；拒绝后授权并重启启动应用。</p>
      {(error || status?.error) && <p role="alert" className="text-red-600">{error || status?.error}</p>}
    </div>}
  </aside>;
}
