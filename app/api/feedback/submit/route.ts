import { handleFeedbackSubmit, getAppConfig } from '@automate/feedback-lib';
const { appName } = getAppConfig();
export const POST = handleFeedbackSubmit(appName);
