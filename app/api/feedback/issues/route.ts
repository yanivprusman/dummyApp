import { handleFeedbackIssues } from '@automate/feedback-lib';
const { GET, POST } = handleFeedbackIssues('dummyApp', { workDir: '/opt/dev/dummyApp' });
export { GET, POST };
