import { handleFeedbackSessionEnd, getAppConfig } from '@automate/feedback-lib';
const { appName } = getAppConfig();
export const POST = handleFeedbackSessionEnd(appName);
