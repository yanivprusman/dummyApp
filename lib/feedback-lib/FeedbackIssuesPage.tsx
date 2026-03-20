"use client";

import { useState, useEffect, useCallback } from "react";
import { feedbackTranslations } from "./i18n";

interface Issue {
  issueNumber: number;
  title: string;
  description: string;
  status: string;
  labels: string[];
  createdAt: string;
  closedAt?: string;
  insights?: string;
}

export interface IssuesPageLabels {
  pageTitle: string;
  loading: string;
  error: string;
  noIssues: string;
  open: string;
  closed: string;
  inProgress: string;
  review: string;
  edit: string;
  save: string;
  cancel: string;
}

const defaultLabels: IssuesPageLabels = {
  pageTitle: "Issues",
  loading: "Loading issues...",
  error: "Failed to load issues.",
  noIssues: "No issues found.",
  open: "Open",
  closed: "Closed",
  inProgress: "In Progress",
  review: "Needs Review",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
};

const heLabels: IssuesPageLabels = {
  pageTitle: "תקלות",
  loading: "טוען תקלות...",
  error: "שגיאה בטעינת תקלות.",
  noIssues: "לא נמצאו תקלות.",
  open: "פתוח",
  closed: "סגור",
  inProgress: "בטיפול",
  review: "ממתין לאישור",
  edit: "עריכה",
  save: "שמירה",
  cancel: "ביטול",
};

const issuesTranslations: Record<string, IssuesPageLabels> = {
  en: defaultLabels,
  he: heLabels,
};

interface FeedbackIssuesPageProps {
  lang?: string;
  labels?: Partial<IssuesPageLabels>;
  colorScheme?: "system" | "light" | "dark";
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

function statusBadge(status: string, labels: IssuesPageLabels, isDark: boolean) {
  const map: Record<string, { label: string; bg: string }> = {
    open: { label: labels.open, bg: isDark ? "bg-green-900 text-green-300" : "bg-green-100 text-green-800" },
    closed: { label: labels.closed, bg: isDark ? "bg-slate-700 text-slate-400" : "bg-slate-200 text-slate-600" },
    in_progress: { label: labels.inProgress, bg: isDark ? "bg-yellow-900 text-yellow-300" : "bg-yellow-100 text-yellow-800" },
    review: { label: labels.review, bg: isDark ? "bg-purple-900 text-purple-300" : "bg-purple-100 text-purple-800" },
  };
  const entry = map[status] ?? map.open;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${entry.bg}`}>
      {entry.label}
    </span>
  );
}

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export function FeedbackIssuesPage({ lang, labels: labelOverrides, colorScheme = "system" }: FeedbackIssuesPageProps) {
  const langLabels = lang ? (issuesTranslations[lang] ?? defaultLabels) : defaultLabels;
  const labels = { ...langLabels, ...labelOverrides };
  const systemDark = useSystemDark();
  const isDark = colorScheme === "dark" || (colorScheme !== "light" && systemDark);

  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const fetchIssues = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/feedback/issues");
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const all: Issue[] = Array.isArray(data.issues) ? data.issues : [];
      // Only show user-reported issues, sorted: open/in_progress first, then closed; newest first within each group
      const list = all
        .filter(i => i.labels?.includes("user-reported"))
        .sort((a, b) => {
          const order: Record<string, number> = { open: 0, in_progress: 1, review: 2, closed: 3 };
          const statusDiff = (order[a.status] ?? 0) - (order[b.status] ?? 0);
          if (statusDiff !== 0) return statusDiff;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      setIssues(list);
    } catch {
      setError(labels.error);
    } finally {
      setLoading(false);
    }
  }, [labels.error]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  function startEdit(issue: Issue) {
    setEditingId(issue.issueNumber);
    setEditTitle(issue.title);
    setEditDesc(issue.description || "");
    setExpandedIds(prev => new Set(prev).add(issue.issueNumber));
  }

  async function handleSaveEdit(issueNumber: number) {
    setActionLoading(issueNumber);
    try {
      const res = await fetch("/api/feedback/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", issueNumber, title: editTitle, description: editDesc }),
      });
      if (res.ok) {
        setIssues(prev => prev.map(issue =>
          issue.issueNumber === issueNumber ? { ...issue, title: editTitle, description: editDesc } : issue
        ));
        setEditingId(null);
      }
    } catch { /* ignore */ }
    setActionLoading(null);
  }

  const bgClass = isDark ? "bg-slate-900 text-slate-200" : "bg-white text-slate-900";
  const cardClass = isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200";

  return (
    <div className={`min-h-screen ${bgClass} p-6`}>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{labels.pageTitle}</h1>
        </div>

        {loading && <p className={isDark ? "text-slate-400" : "text-slate-500"}>{labels.loading}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && !error && issues.length === 0 && (
          <p className={isDark ? "text-slate-400" : "text-slate-500"}>{labels.noIssues}</p>
        )}

        <div className="space-y-3">
          {issues.map((issue) => {
            const isExpanded = expandedIds.has(issue.issueNumber);
            const isEditing = editingId === issue.issueNumber;
            const hasLongDesc = issue.description && issue.description.length > 120;

            return (
              <div key={issue.issueNumber} className={`border rounded-lg p-4 ${cardClass} transition-colors`}>
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>#{issue.issueNumber}</span>
                      {statusBadge(issue.status, labels, isDark)}
                    </div>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      className={`w-full px-3 py-1.5 rounded-md border text-sm font-medium ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-slate-300 text-slate-900"}`}
                    />
                    <textarea
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      rows={4}
                      className={`w-full px-3 py-1.5 rounded-md border text-sm ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-slate-300 text-slate-900"} whitespace-pre-wrap`}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(issue.issueNumber)}
                        disabled={actionLoading === issue.issueNumber}
                        className={`text-xs px-3 py-1.5 rounded-md transition-colors ${isDark ? "bg-indigo-700 hover:bg-indigo-600 text-white" : "bg-indigo-500 hover:bg-indigo-600 text-white"} disabled:opacity-50`}
                      >
                        {labels.save}
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className={`text-xs px-3 py-1.5 rounded-md transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}
                      >
                        {labels.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => setExpandedIds(prev => { const next = new Set(prev); if (next.has(issue.issueNumber)) next.delete(issue.issueNumber); else next.add(issue.issueNumber); return next; })}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>#{issue.issueNumber}</span>
                        {statusBadge(issue.status, labels, isDark)}
                        {issue.labels?.map((label, i) => (
                          <span key={`${label}-${i}`} className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-slate-700 text-slate-400" : "bg-slate-100 text-slate-500"}`}>
                            {label}
                          </span>
                        ))}
                      </div>
                      <h3 className="font-medium">{issue.title}</h3>
                      {issue.description && (
                        <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-600"} ${!isExpanded && hasLongDesc ? "line-clamp-2" : ""} whitespace-pre-wrap`}>
                          {issue.description}
                        </p>
                      )}
                      {issue.insights && isExpanded && (
                        <p className={`text-sm mt-2 italic ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                          {issue.insights}
                        </p>
                      )}
                      <p className={`text-xs mt-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                        {formatDate(issue.createdAt)}
                      </p>
                    </div>

                    <div className="flex-shrink-0">
                      <button
                        onClick={() => startEdit(issue)}
                        className={`text-xs px-3 py-1.5 rounded-md transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}
                      >
                        {labels.edit}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
