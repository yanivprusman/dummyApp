import { handleFeedbackSessionHistory, getAppConfig } from '@addnewfeature/feedback-lib-launcher';
const { appName, workDir } = getAppConfig();
export const GET = handleFeedbackSessionHistory(appName, workDir);
