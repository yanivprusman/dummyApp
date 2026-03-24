import { handleFeedbackMessage, getAppConfig } from '@automate/feedback-lib';
const { appName, workDir } = getAppConfig();
export const POST = handleFeedbackMessage(appName, workDir);
