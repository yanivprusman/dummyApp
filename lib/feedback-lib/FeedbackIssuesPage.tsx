"use client";

import { useState, useEffect, useCallback } from "react";
import { feedbackTranslations } from "./i18n";

interface Issue {
  issue_number: number;
  title: string;
  description: string;
  status: string;
  labels: string[];
  created_at: string;
  closed_at?: string;
  insights?: string;
}

export interface IssuesPageLabels {
  pageTitle: string;
  loading: string;
  error: string;
  noIssues: string;
  close: string;
  reopen: string;
  open: string;
  closed: string;
  inProgress: string;
  back: string;
}

const defaultLabels: IssuesPageLabels = {
  pageTitle: "Issues",
  loading: "Loading issues...",
  error: "Failed to load issues.",
  noIssues: "No issues found.",
  close: "Close",
  reopen: "Reopen",
  open: "Open",
  closed: "Closed",
  inProgress: "In Progress",
  back: "Back",
};

const heLabels: IssuesPageLabels = {
  pageTitle: "תקלות",
  loading: "טוען תקלות...",
  error: "שגיאה בטעינת תקלות.",
  noIssues: "לא נמצאו תקלות.",
  close: "סגירה",
  reopen: "פתיחה מחדש",
  open: "פתוח",
  closed: "סגור",
  inProgress: "בטיפול",
  back: "חזרה",
};

const issuesTranslations: Record<string, IssuesPageLabels> = {
  en: defaultLabels,
  he: heLabels,
};

interface FeedbackIssuesPageProps {
  lang?: string;
  labels?: Partial<IssuesPageLabels>;
  colorScheme?: "system" | "light" | "dark";
  backPath?: string;
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
    return new Date(dateStr).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export function FeedbackIssuesPage({ lang, labels: labelOverrides, colorScheme = "system", backPath }: FeedbackIssuesPageProps) {
  const langLabels = lang ? (issuesTranslations[lang] ?? defaultLabels) : defaultLabels;
  const labels = { ...langLabels, ...labelOverrides };
  const systemDark = useSystemDark();
  const isDark = colorScheme === "dark" || (colorScheme !== "light" && systemDark);

  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const fetchIssues = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/feedback/issues");
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      const list: Issue[] = Array.isArray(data.issues) ? data.issues : [];
      // Sort: open/in_progress first, then closed
      list.sort((a, b) => {
        const order: Record<string, number> = { open: 0, in_progress: 1, closed: 2 };
        return (order[a.status] ?? 0) - (order[b.status] ?? 0);
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

  async function handleAction(issueNumber: number, action: "close" | "reopen") {
    setActionLoading(issueNumber);
    try {
      const res = await fetch("/api/feedback/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, issueNumber }),
      });
      if (res.ok) {
        setIssues((prev) =>
          prev.map((issue) =>
            issue.issue_number === issueNumber
              ? { ...issue, status: action === "close" ? "closed" : "open" }
              : issue,
          ),
        );
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
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{labels.pageTitle}</h1>
          {backPath && (
            <a href={backPath} className={`text-sm ${isDark ? "text-indigo-400 hover:text-indigo-300" : "text-indigo-600 hover:text-indigo-500"} transition-colors`}>
              {labels.back}
            </a>
          )}
        </div>

        {loading && <p className={isDark ? "text-slate-400" : "text-slate-500"}>{labels.loading}</p>}
        {error && <p className="text-red-500">{error}</p>}

        {!loading && !error && issues.length === 0 && (
          <p className={isDark ? "text-slate-400" : "text-slate-500"}>{labels.noIssues}</p>
        )}

        <div className="space-y-3">
          {issues.map((issue) => {
            const isExpanded = expandedId === issue.issue_number;
            const hasLongDesc = issue.description && issue.description.length > 120;

            return (
              <div key={issue.issue_number} className={`border rounded-lg p-4 ${cardClass} transition-colors`}>
                {/* Issue header row */}
                <div className="flex items-start justify-between gap-3">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : issue.issue_number)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>#{issue.issue_number}</span>
                      {statusBadge(issue.status, labels, isDark)}
                      {issue.labels?.map((label) => (
                        <span key={label} className={`text-xs px-1.5 py-0.5 rounded ${isDark ? "bg-slate-700 text-slate-400" : "bg-slate-100 text-slate-500"}`}>
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
                      {formatDate(issue.created_at)}
                    </p>
                  </div>

                  {/* Action button */}
                  <div className="flex-shrink-0">
                    {issue.status !== "closed" ? (
                      <button
                        onClick={() => handleAction(issue.issue_number, "close")}
                        disabled={actionLoading === issue.issue_number}
                        className={`text-xs px-3 py-1.5 rounded-md transition-colors ${isDark ? "bg-slate-700 hover:bg-slate-600 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700"} disabled:opacity-50`}
                      >
                        {labels.close}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAction(issue.issue_number, "reopen")}
                        disabled={actionLoading === issue.issue_number}
                        className={`text-xs px-3 py-1.5 rounded-md transition-colors ${isDark ? "bg-indigo-900 hover:bg-indigo-800 text-indigo-300" : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700"} disabled:opacity-50`}
                      >
                        {labels.reopen}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
