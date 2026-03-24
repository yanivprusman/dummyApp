import { handleFeedbackIssues, getAppConfig } from '@automate/feedback-lib';
const { appName, workDir } = getAppConfig();
const { GET, POST } = handleFeedbackIssues(appName, { workDir });
export { GET, POST };
