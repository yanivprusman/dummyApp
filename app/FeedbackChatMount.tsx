'use client';

import { FeedbackChat } from '@automate/feedback-lib/core';
import { feedbackBackend } from '@/lib/feedback-backend';

export default function FeedbackChatMount() {
  return <FeedbackChat backend={feedbackBackend} />;
}
