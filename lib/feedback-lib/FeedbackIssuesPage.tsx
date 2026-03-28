"use client";

import { useState, useEffect, useCallback } from "react";

interface Issue {
  issueNumber: number;
  title: string;
  description: string;
  status: string;
  labels: string[];
  createdAt: string;
  closedAt?: string;
  insights?: string;
  claudeSessionId?: string;
  claudeSessionIds?: string[];
  claudeLaunchDir?: string;
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
  fixWithClaude: string;
  markReviewed: string;
  conclude: string;
  alsoInSession: string;
  launching: string;
  reviewing: string;
  refresh: string;
  newIssue: string;
  titlePlaceholder: string;
  descriptionPlaceholder: string;
  submit: string;
  creating: string;
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
  fixWithClaude: "Fix with Claude",
  markReviewed: "Mark as Reviewed",
  conclude: "Run conclude (document work)",
  alsoInSession: "Also fixed in this session:",
  launching: "Launching...",
  reviewing: "Reviewing...",
  refresh: "Refresh",
  newIssue: "New Issue",
  titlePlaceholder: "Issue title",
  descriptionPlaceholder: "Description (optional)",
  submit: "Create",
  creating: "Creating...",
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
  fixWithClaude: "תיקון עם Claude",
  markReviewed: "סימון כנבדק",
  conclude: "תיעוד עבודה",
  alsoInSession: "תוקנו גם בסשן זה:",
  launching: "משיק...",
  reviewing: "מסמן...",
  refresh: "רענון",
  newIssue: "תקלה חדשה",
  titlePlaceholder: "כותרת התקלה",
  descriptionPlaceholder: "תיאור (אופציונלי)",
  submit: "יצירה",
  creating: "יוצר...",
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

interface ReviewDialogState {
  trigger: Issue;
  relatedIssues: Issue[];
  selectedNumbers: Set<number>;
  conclude: boolean;
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

  const [appName, setAppName] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");

  // Selection for fix
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [fixLoading, setFixLoading] = useState(false);

  // Review dialog
  const [reviewDialog, setReviewDialog] = useState<ReviewDialogState | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const fetchIssues = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/feedback/issues");
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      if (data.appName) setAppName(data.appName);
      const all: Issue[] = Array.isArray(data.issues) ? data.issues : [];
      // Only show user-reported issues, sorted: open/in_progress first, then review, then closed; newest first within each group
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
    const interval = setInterval(fetchIssues, 15_000);
    return () => clearInterval(interval);
  }, [fetchIssues]);

  function toggleSelect(issueNumber: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(issueNumber)) next.delete(issueNumber);
      else next.add(issueNumber);
      return next;
    });
  }

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

  async function handleFixWithClaude() {
    const selected = issues.filter(i => selectedIds.has(i.issueNumber) && i.status !== "closed");
    if (selected.length === 0) return;
    setFixLoading(true);
    try {
      const res = await fetch("/api/feedback/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "fix",
          issues: selected.map(i => ({ number: i.issueNumber, title: i.title })),
        }),
      });
      if (res.ok) {
        // Optimistically mark as in_progress
        setIssues(prev => prev.map(i =>
          selectedIds.has(i.issueNumber) ? { ...i, status: "in_progress" } : i
        ));
        setSelectedIds(new Set());
      }
    } catch { /* ignore */ }
    setFixLoading(false);
  }

  function openReviewDialog(issue: Issue) {
    // Find other review-status issues with the same claudeSessionId
    const related = issue.claudeSessionId
      ? issues.filter(i =>
          i.issueNumber !== issue.issueNumber &&
          i.status === "review" &&
          i.claudeSessionId === issue.claudeSessionId
        )
      : [];

    const allNumbers = new Set([issue.issueNumber, ...related.map(i => i.issueNumber)]);
    setReviewDialog({
      trigger: issue,
      relatedIssues: related,
      selectedNumbers: allNumbers,
      conclude: true,
    });
  }

  async function handleCreateIssue() {
    if (!createTitle.trim()) return;
    setCreateLoading(true);
    try {
      const res = await fetch("/api/feedback/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", title: createTitle, description: createDesc }),
      });
      if (res.ok) {
        setCreateTitle("");
        setCreateDesc("");
        setShowCreateForm(false);
        fetchIssues();
      }
    } catch { /* ignore */ }
    setCreateLoading(false);
  }

  function toggleReviewIssue(issueNumber: number) {
    if (!reviewDialog) return;
    // Don't allow deselecting the trigger issue
    if (issueNumber === reviewDialog.trigger.issueNumber) return;
    setReviewDialog(prev => {
      if (!prev) return null;
      const next = new Set(prev.selectedNumbers);
      if (next.has(issueNumber)) next.delete(issueNumber);
      else next.add(issueNumber);
      return { ...prev, selectedNumbers: next };
    });
  }

  async function handleConfirmReview() {
    if (!reviewDialog) return;
    setReviewLoading(true);
    try {
      const res = await fetch("/api/feedback/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reviewed",
          issueNumbers: Array.from(reviewDialog.selectedNumbers),
          conclude: reviewDialog.conclude,
          claudeSessionId: reviewDialog.trigger.claudeSessionId,
          claudeLaunchDir: reviewDialog.trigger.claudeLaunchDir,
        }),
      });
      if (res.ok) {
        // Optimistically mark as closed
        setIssues(prev => prev.map(i =>
          reviewDialog.selectedNumbers.has(i.issueNumber) ? { ...i, status: "closed" } : i
        ));
        setReviewDialog(null);
      }
    } catch { /* ignore */ }
    setReviewLoading(false);
  }

  const selectedCount = issues.filter(i => selectedIds.has(i.issueNumber) && i.status !== "closed" && i.status !== "review").length;

  const bgClass = isDark ? "bg-slate-900 text-slate-200" : "bg-white text-slate-900";
  const cardClass = isDark ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200";
  const btnClass = isDark ? "bg-slate-700 hover:bg-slate-600 text-slate-300" : "bg-slate-100 hover:bg-slate-200 text-slate-700";
  const btnPrimaryClass = isDark ? "bg-indigo-700 hover:bg-indigo-600 text-white" : "bg-indigo-500 hover:bg-indigo-600 text-white";
  const dialogBgClass = isDark ? "bg-slate-800 border-slate-600" : "bg-white border-slate-300";

  return (
    <div className={`min-h-screen ${bgClass} p-6`}>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{appName ? `${appName} — ${labels.pageTitle}` : labels.pageTitle}</h1>
          <div className="flex items-center gap-2">
          <button
            data-id="new-issue"
            onClick={() => setShowCreateForm(v => !v)}
            className={`text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 active:scale-95 ${
              showCreateForm
                ? isDark ? "bg-green-700 text-white" : "bg-green-500 text-white"
                : isDark ? "bg-green-800 hover:bg-green-700 text-green-200" : "bg-green-100 hover:bg-green-200 text-green-700"
            }`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            {labels.newIssue}
          </button>
          <button
            data-id="refresh-issues"
            onClick={() => fetchIssues()}
            title={labels.refresh}
            className={`p-2 rounded-lg transition-colors cursor-pointer ${btnClass} active:scale-95`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
          </button>
          <button
            data-id="fix-with-claude"
            onClick={handleFixWithClaude}
            disabled={selectedCount === 0 || fixLoading}
            className={`text-sm px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
              selectedCount > 0
                ? isDark ? "bg-purple-700 hover:bg-purple-600 text-white cursor-pointer" : "bg-purple-500 hover:bg-purple-600 text-white cursor-pointer"
                : isDark ? "bg-slate-700 text-slate-500 cursor-not-allowed" : "bg-slate-200 text-slate-400 cursor-not-allowed"
            } disabled:opacity-50 active:scale-95`}
          >
            {fixLoading ? (
              <>{labels.launching}</>
            ) : (
              <>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" /><path d="M18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" /></svg>
                {labels.fixWithClaude}{selectedCount > 0 ? ` (${selectedCount})` : ""}
              </>
            )}
          </button>
          </div>
        </div>

        {/* Create Issue Form */}
        {showCreateForm && (
          <div className={`mb-4 border rounded-lg p-4 ${cardClass}`}>
            <input
              data-id="create-title"
              type="text"
              placeholder={labels.titlePlaceholder}
              value={createTitle}
              onChange={e => setCreateTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && createTitle.trim()) handleCreateIssue(); }}
              className={`w-full px-3 py-1.5 rounded-md border text-sm font-medium mb-2 ${isDark ? "bg-slate-700 border-slate-600 text-slate-200 placeholder-slate-500" : "bg-white border-slate-300 text-slate-900 placeholder-slate-400"}`}
              autoFocus
            />
            <textarea
              data-id="create-description"
              placeholder={labels.descriptionPlaceholder}
              value={createDesc}
              onChange={e => setCreateDesc(e.target.value)}
              rows={3}
              className={`w-full px-3 py-1.5 rounded-md border text-sm mb-3 ${isDark ? "bg-slate-700 border-slate-600 text-slate-200 placeholder-slate-500" : "bg-white border-slate-300 text-slate-900 placeholder-slate-400"} whitespace-pre-wrap`}
            />
            <div className="flex gap-2">
              <button
                data-id="create-submit"
                onClick={handleCreateIssue}
                disabled={!createTitle.trim() || createLoading}
                className={`text-xs px-4 py-1.5 rounded-md transition-colors cursor-pointer ${btnPrimaryClass} disabled:opacity-50 active:scale-95`}
              >
                {createLoading ? labels.creating : labels.submit}
              </button>
              <button
                data-id="create-cancel"
                onClick={() => { setShowCreateForm(false); setCreateTitle(""); setCreateDesc(""); }}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer ${btnClass} active:scale-95`}
              >
                {labels.cancel}
              </button>
            </div>
          </div>
        )}

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
            const canSelect = issue.status !== "closed" && issue.status !== "review";
            const isReview = issue.status === "review";

            return (
              <div key={issue.issueNumber} className={`border rounded-lg p-4 ${cardClass} transition-colors ${isReview ? (isDark ? "border-purple-700/50" : "border-purple-200") : ""}`}>
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-mono ${isDark ? "text-slate-500" : "text-slate-400"}`}>#{issue.issueNumber}</span>
                      {statusBadge(issue.status, labels, isDark)}
                    </div>
                    <input
                      data-id="edit-title"
                      type="text"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      className={`w-full px-3 py-1.5 rounded-md border text-sm font-medium ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-slate-300 text-slate-900"}`}
                    />
                    <textarea
                      data-id="edit-description"
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      rows={4}
                      className={`w-full px-3 py-1.5 rounded-md border text-sm ${isDark ? "bg-slate-700 border-slate-600 text-slate-200" : "bg-white border-slate-300 text-slate-900"} whitespace-pre-wrap`}
                    />
                    <div className="flex gap-2">
                      <button
                        data-id="save-edit"
                        onClick={() => handleSaveEdit(issue.issueNumber)}
                        disabled={actionLoading === issue.issueNumber}
                        className={`text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer ${btnPrimaryClass} disabled:opacity-50 active:scale-95`}
                      >
                        {labels.save}
                      </button>
                      <button
                        data-id="cancel-edit"
                        onClick={() => setEditingId(null)}
                        className={`text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer ${btnClass} active:scale-95`}
                      >
                        {labels.cancel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    {/* Checkbox for selectable issues */}
                    {canSelect && (
                      <div className="pt-1 flex-shrink-0">
                        <input
                          data-id={`select-issue-${issue.issueNumber}`}
                          type="checkbox"
                          checked={selectedIds.has(issue.issueNumber)}
                          onChange={() => toggleSelect(issue.issueNumber)}
                          className="w-4 h-4 accent-purple-500 cursor-pointer"
                        />
                      </div>
                    )}

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

                    <div className="flex-shrink-0 flex items-center gap-2">
                      {/* Mark as Reviewed button for review-status issues */}
                      {isReview && (
                        <button
                          data-id={`mark-reviewed-${issue.issueNumber}`}
                          onClick={() => openReviewDialog(issue)}
                          className={`text-xs px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 cursor-pointer active:scale-95 ${
                            isDark ? "bg-purple-800 hover:bg-purple-700 text-purple-200" : "bg-purple-100 hover:bg-purple-200 text-purple-700"
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                          {labels.markReviewed}
                        </button>
                      )}
                      <button
                        data-id={`edit-issue-${issue.issueNumber}`}
                        onClick={() => startEdit(issue)}
                        className={`text-xs px-3 py-1.5 rounded-md transition-colors cursor-pointer ${btnClass} active:scale-95`}
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

      {/* Review Dialog Overlay */}
      {reviewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => !reviewLoading && setReviewDialog(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className={`relative border rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 ${dialogBgClass}`}
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold mb-4">{labels.markReviewed}</h2>

            {/* Trigger issue (always selected, can't deselect) */}
            <label className="flex items-center gap-3 py-2">
              <input data-id="review-trigger-issue" type="checkbox" checked disabled className="w-4 h-4 accent-purple-500" />
              <span className="text-sm">
                <span className={`font-mono text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>#{reviewDialog.trigger.issueNumber}</span>
                {" "}{reviewDialog.trigger.title}
              </span>
            </label>

            {/* Related issues from same session */}
            {reviewDialog.relatedIssues.length > 0 && (
              <div className="mt-3">
                <p className={`text-xs font-medium mb-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  {labels.alsoInSession}
                </p>
                {reviewDialog.relatedIssues.map(ri => (
                  <label key={ri.issueNumber} className="flex items-center gap-3 py-1.5 cursor-pointer">
                    <input
                      data-id={`review-related-${ri.issueNumber}`}
                      type="checkbox"
                      checked={reviewDialog.selectedNumbers.has(ri.issueNumber)}
                      onChange={() => toggleReviewIssue(ri.issueNumber)}
                      className="w-4 h-4 accent-purple-500 cursor-pointer"
                    />
                    <span className="text-sm">
                      <span className={`font-mono text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>#{ri.issueNumber}</span>
                      {" "}{ri.title}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {/* Conclude toggle */}
            <label className={`flex items-center gap-3 mt-4 py-2 px-3 rounded-lg cursor-pointer ${isDark ? "bg-slate-700/50" : "bg-slate-50"}`}>
              <input
                data-id="review-conclude-toggle"
                type="checkbox"
                checked={reviewDialog.conclude}
                onChange={() => setReviewDialog(prev => prev ? { ...prev, conclude: !prev.conclude } : null)}
                className="w-4 h-4 accent-purple-500 cursor-pointer"
              />
              <span className="text-sm">{labels.conclude}</span>
            </label>

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6">
              <button
                data-id="review-cancel"
                onClick={() => setReviewDialog(null)}
                disabled={reviewLoading}
                className={`text-sm px-4 py-2 rounded-lg transition-colors cursor-pointer ${btnClass} active:scale-95`}
              >
                {labels.cancel}
              </button>
              <button
                data-id="review-confirm"
                onClick={handleConfirmReview}
                disabled={reviewLoading}
                className={`text-sm px-4 py-2 rounded-lg transition-colors flex items-center gap-2 cursor-pointer ${
                  isDark ? "bg-purple-700 hover:bg-purple-600 text-white" : "bg-purple-500 hover:bg-purple-600 text-white"
                } disabled:opacity-50 active:scale-95`}
              >
                {reviewLoading ? (
                  <>{labels.reviewing}</>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                    {labels.markReviewed}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
