import { handleFeedbackClose, getAppConfig } from '@automate/feedback-lib';
const { appName } = getAppConfig();
export const POST = handleFeedbackClose(appName);
