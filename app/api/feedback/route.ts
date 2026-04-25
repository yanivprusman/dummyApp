import { handleFeedbackMessage, getAppConfig } from '@addnewfeature/feedback-lib-launcher';
const { appName, workDir } = getAppConfig();
export const POST = handleFeedbackMessage(appName, workDir);
