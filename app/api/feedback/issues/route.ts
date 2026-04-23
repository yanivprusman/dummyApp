import { handleFeedbackIssues, getAppConfig } from '@addnewfeature/feedback-lib-launcher';
const { appName, workDir } = getAppConfig();
const { GET, POST } = handleFeedbackIssues(appName, { workDir });
export { GET, POST };
