"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { feedbackTranslations } from "./i18n";

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface Issue {
  title: string;
  description: string;
}

interface SubmitResult {
  title: string;
  issueNumber?: number;
  success: boolean;
}

export interface FeedbackLabels {
  greeting: string;
  title: string;
  newChat: string;
  selectIssues: string;
  submit: string;
  submitting: string;
  issueSubmitted: string;
  error: string;
  placeholder: string;
  button: string;
  thinking: string;
  endSession: string;
  sessionActive: string;
  timeoutError: string;
  networkError: string;
  viewIssues: string;
}

const defaultLabels: FeedbackLabels = {
  greeting: "Hi! Use this chat to report bugs, suggest features, or share any feedback with the development team. Describe what's on your mind and I'll help you put together a clear report.",
  title: "Issue Clarifier",
  newChat: "New Chat",
  selectIssues: "Select the issues to submit:",
  submit: "Submit Selected",
  submitting: "Submitting...",
  issueSubmitted: "Issue #",
  error: "Something went wrong. Please try again.",
  placeholder: "Describe your issue or idea...",
  button: "Issue Clarifier",
  thinking: "Thinking...",
  endSession: "End Session",
  sessionActive: "Session active",
  timeoutError: "Claude did not respond in time. The Stop hook may be misconfigured.",
  networkError: "Network error — check your connection and try again.",
  viewIssues: "View Issues",
};

interface FeedbackChatProps {
  /** Language code for built-in translations (e.g. "en", "he"). Defaults to "en". */
  lang?: string;
  /** Override individual labels (merged on top of lang translations) */
  labels?: Partial<FeedbackLabels>;
  /** Custom accent color class (default: "bg-indigo-600 hover:bg-indigo-700") */
  accentClass?: string;
  /** Color scheme: 'system' follows OS preference, 'light' or 'dark' forces a mode */
  colorScheme?: 'system' | 'light' | 'dark';
  /** Path to the issues page (e.g. "/issues"). If set, shows a link in the header. */
  issuesPath?: string;
}

const SESSION_STORAGE_KEY = "feedback-chat-session";

interface PersistedSession {
  sessionId: string;
  tmuxSession: string;
  messages: Message[];
}

function useSystemDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return dark;
}

export function FeedbackChat({ lang, labels: labelOverrides, accentClass, colorScheme = 'system', issuesPath }: FeedbackChatProps = {}) {
  const langLabels = lang ? (feedbackTranslations[lang] ?? defaultLabels) : defaultLabels;
  const labels = { ...langLabels, ...labelOverrides };
  const accent = accentClass ?? "bg-indigo-600 hover:bg-indigo-700";
  const accentBase = accent.split(" ")[0]; // e.g. "bg-indigo-600"
  const systemDark = useSystemDark();
  const isDark = colorScheme === 'dark' || (colorScheme !== 'light' && systemDark);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tmuxSession, setTmuxSession] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [checkedIssues, setCheckedIssues] = useState<boolean[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitResults, setSubmitResults] = useState<SubmitResult[] | null>(null);
  const [hookWarning, setHookWarning] = useState<string | null>(null);
  const [restoredSession, setRestoredSession] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasSession = sessionId !== null;

  // Persist session to sessionStorage whenever it changes
  useEffect(() => {
    if (sessionId && tmuxSession) {
      const data: PersistedSession = { sessionId, tmuxSession, messages };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
    }
  }, [sessionId, tmuxSession, messages]);

  // Restore session from sessionStorage on mount
  useEffect(() => {
    if (restoredSession) return;
    setRestoredSession(true);

    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return;

    try {
      const data: PersistedSession = JSON.parse(stored);
      if (!data.sessionId || !data.tmuxSession) return;

      // Verify the session is still alive
      fetch(`/api/feedback/status?tmuxSession=${encodeURIComponent(data.tmuxSession)}`)
        .then(res => res.json())
        .then(result => {
          if (result.alive) {
            setSessionId(data.sessionId);
            setTmuxSession(data.tmuxSession);
            if (data.messages?.length > 0) {
              setMessages(data.messages);
            }
          } else {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
          }
        })
        .catch(() => {
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
        });
    } catch {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, [restoredSession]);

  // Poll session status while active — detect when tmux dies (e.g. SessionEnd hook killed it)
  useEffect(() => {
    if (!hasSession || !tmuxSession) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/feedback/status?tmuxSession=${encodeURIComponent(tmuxSession)}`);
        const data = await res.json();
        if (!data.alive) {
          setSessionId(null);
          setTmuxSession(null);
          setHookWarning(null);
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
        }
      } catch { /* ignore fetch errors */ }
    }, 15_000);
    return () => clearInterval(interval);
  }, [hasSession, tmuxSession]);

  // Clean up session on page unload via sendBeacon
  useEffect(() => {
    function handleUnload() {
      if (tmuxSession) {
        const body = JSON.stringify({ tmuxSession });
        navigator.sendBeacon("/api/feedback/close", new Blob([body], { type: "application/json" }));
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, [tmuxSession]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, issues, submitResults]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  function handleOpen() {
    setOpen(true);
    if (messages.length === 0) {
      setMessages([{ role: "assistant", text: labels.greeting }]);
    }
  }

  function handleClose() {
    setOpen(false);
  }

  const closeSession = useCallback(() => {
    if (tmuxSession) {
      fetch("/api/feedback/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmuxSession }),
      }).catch(() => {});
    }
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setSessionId(null);
    setTmuxSession(null);
    setHookWarning(null);
  }, [tmuxSession]);

  function handleNewChat() {
    closeSession();
    setMessages([{ role: "assistant", text: labels.greeting }]);
    setInput("");
    setIssues(null);
    setCheckedIssues([]);
    setSubmitResults(null);
  }

  function handleEndSession() {
    closeSession();
    setMessages([{ role: "assistant", text: labels.greeting }]);
    setInput("");
    setIssues(null);
    setCheckedIssues([]);
    setSubmitResults(null);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);
    setIssues(null);
    setCheckedIssues([]);
    setSubmitResults(null);

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId, tmuxSession }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 504 || data.error === 'timeout') {
          setMessages((prev) => [...prev, { role: "assistant", text: labels.timeoutError }]);
          // Preserve session info from timeout response
          if (data.sessionId) setSessionId(data.sessionId);
          if (data.tmuxSession) setTmuxSession(data.tmuxSession);
          return;
        }
        throw new Error(data.message || "Request failed");
      }

      const data = await res.json();
      setSessionId(data.sessionId);
      setTmuxSession(data.tmuxSession);
      if (data.hookWarning) setHookWarning(data.hookWarning);

      let displayText = data.response;
      if (data.issues) {
        displayText = displayText.replace(/```json\s*\n[\s\S]*?\n```\s*/g, "").trim();
      }

      setMessages((prev) => [...prev, { role: "assistant", text: displayText }]);

      if (data.issues) {
        setIssues(data.issues);
        setCheckedIssues(new Array(data.issues.length).fill(true));
      }
    } catch (err) {
      const isNetwork = err instanceof TypeError && err.message === 'Failed to fetch';
      setMessages((prev) => [...prev, { role: "assistant", text: isNetwork ? labels.networkError : labels.error }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitIssues() {
    if (!issues || submitting) return;

    const selected = issues.filter((_, i) => checkedIssues[i]);
    if (selected.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issues: selected }),
      });

      if (!res.ok) throw new Error("Submit failed");

      const data = await res.json();
      setSubmitResults(data.results);
      setIssues(null);
      setCheckedIssues([]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: labels.error }]);
    } finally {
      setSubmitting(false);
    }
  }

  function toggleIssue(index: number) {
    setCheckedIssues((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!open) {
    return (
      <div className="fixed bottom-6 end-6 z-50">
        <button
          onClick={handleOpen}
          className={`w-14 h-14 ${accent} text-white rounded-full shadow-lg flex items-center justify-center transition-colors relative`}
          title={labels.button}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {/* Session active indicator dot */}
          {hasSession && (
            <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-green-400 border-2 border-white rounded-full" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className={`fixed bottom-6 end-6 z-50 w-96 max-h-[min(32rem,calc(100dvh-3rem))] ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'} rounded-2xl shadow-2xl border flex flex-col overflow-hidden`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-3 ${accentBase} text-white`}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{labels.title}</span>
          {hasSession && (
            <span className="flex items-center gap-1 text-xs opacity-80">
              <span className="w-2 h-2 bg-green-400 rounded-full inline-block" />
              {labels.sessionActive}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasSession && (
            <button onClick={handleEndSession} className="text-xs text-indigo-200 hover:text-white transition-colors" title={labels.endSession}>
              {labels.endSession}
            </button>
          )}
          <button onClick={handleNewChat} className="text-xs text-indigo-200 hover:text-white transition-colors" title={labels.newChat}>
            {labels.newChat}
          </button>
          {issuesPath && (
            <a href={issuesPath} className="text-xs text-indigo-200 hover:text-white transition-colors" title={labels.viewIssues}>
              {labels.viewIssues}
            </a>
          )}
          <button onClick={handleClose} className="text-indigo-200 hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Hook warning banner */}
      {hookWarning && (
        <div className={`px-3 py-2 text-xs ${isDark ? 'bg-yellow-900/40 text-yellow-300 border-yellow-800' : 'bg-yellow-50 text-yellow-800 border-yellow-200'} border-b`}>
          {hookWarning}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[12rem] max-h-[20rem]">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${msg.role === "user" ? `${accentBase} text-white` : `${isDark ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-800'}`}`}>
              {msg.text}
            </div>
          </div>
        ))}

        {/* Issue checklist */}
        {issues && issues.length > 0 && (
          <div className={`${isDark ? 'bg-slate-700/50 border-slate-600' : 'bg-slate-50 border-slate-200'} border rounded-xl p-3 space-y-2`}>
            <p className={`text-xs font-medium ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{labels.selectIssues}</p>
            {issues.map((issue, i) => (
              <label key={i} className={`flex items-start gap-2 cursor-pointer p-2 rounded-lg ${isDark ? 'hover:bg-slate-600' : 'hover:bg-slate-100'} transition-colors`}>
                <input type="checkbox" checked={checkedIssues[i] ?? true} onChange={() => toggleIssue(i)} className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{issue.title}</p>
                  <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'} line-clamp-2`}>{issue.description}</p>
                </div>
              </label>
            ))}
            <button
              onClick={handleSubmitIssues}
              disabled={submitting || !checkedIssues.some(Boolean)}
              className={`w-full mt-1 px-3 py-2 ${accent} ${isDark ? 'disabled:bg-slate-600' : 'disabled:bg-slate-300'} text-white text-sm font-medium rounded-lg transition-colors`}
            >
              {submitting ? labels.submitting : labels.submit}
            </button>
          </div>
        )}

        {/* Submit results */}
        {submitResults && (
          <div className={`${isDark ? 'bg-green-900/30 border-green-800' : 'bg-green-50 border-green-200'} border rounded-xl p-3 space-y-1`}>
            {submitResults.map((result, i) => (
              <p key={i} className={`text-sm ${isDark ? 'text-green-300' : 'text-green-800'}`}>
                {result.success ? `${labels.issueSubmitted}${result.issueNumber ?? "?"} — ${result.title}` : `Failed: ${result.title}`}
              </p>
            ))}
          </div>
        )}

        {loading && (
          <div className="flex justify-start">
            <div className={`${isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-500'} px-3 py-2 rounded-xl text-sm`}>{labels.thinking}</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={`border-t ${isDark ? 'border-slate-700' : 'border-slate-200'} px-3 py-2 flex gap-2`}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={labels.placeholder}
          rows={1}
          className={`flex-1 resize-none rounded-lg border ${isDark ? 'border-slate-600 bg-slate-700 text-slate-200 placeholder-slate-500' : 'border-slate-300 bg-white text-slate-900 placeholder-slate-400'} px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent`}
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className={`px-3 py-2 ${accent} ${isDark ? 'disabled:bg-slate-600' : 'disabled:bg-slate-300'} text-white rounded-lg transition-colors`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
