import { FeedbackLabels } from "./FeedbackChat";

export const feedbackTranslations: Record<string, FeedbackLabels> = {
  en: {
    greeting:
      "Hi! Use this chat to report bugs, suggest features, or share any feedback with the development team. Describe what's on your mind and I'll help you put together a clear report.",
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
    timeoutError:
      "Claude did not respond in time. The Stop hook may be misconfigured.",
    networkError: "Network error — check your connection and try again.",
    viewIssues: "View Issues",
  },
  he: {
    greeting:
      "היי! כאן אפשר לדווח על באגים, להציע פיצ'רים, או לשתף כל משוב עם צוות הפיתוח. תארו מה בראש שלכם ואעזור לכם להכין דיווח ברור.",
    title: "בירור תקלות",
    newChat: "חדש",
    selectIssues: "בחרו את הבעיות שברצונכם לשלוח:",
    submit: "שליחה",
    submitting: "שולח...",
    issueSubmitted: "בעיה מס' ",
    error: "סליחה, משהו השתבש. נסו שוב.",
    placeholder: "תארו את הבעיה או הרעיון...",
    button: "בירור תקלות",
    thinking: "חושב...",
    endSession: "סיום",
    sessionActive: "פעיל",
    timeoutError: "Claude לא הגיב בזמן. ייתכן שה-Stop hook לא מוגדר כראוי.",
    networkError: "שגיאת רשת — בדקו את החיבור ונסו שוב.",
    viewIssues: "צפייה בתקלות",
  },
};
