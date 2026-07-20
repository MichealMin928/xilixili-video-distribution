import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFile = fileURLToPath(import.meta.url);
const sourceRoot = path.resolve(path.dirname(currentFile), '../..');

export const projectRoot = process.env.XILIXILI_PROJECT_ROOT
  ? path.resolve(process.env.XILIXILI_PROJECT_ROOT)
  : sourceRoot;

export const localDir = path.join(projectRoot, '.local');
export const stateFile = path.join(localDir, 'state.json');
export const engagementStateFile = path.join(localDir, 'engagement.json');
export const chromeProfileDir = path.join(localDir, 'chrome-profile');
export const screenshotDir = path.join(projectRoot, 'output', 'playwright');
export const engagementScreenshotDir = path.join(projectRoot, 'output', 'engagement');
export const webDistDir = path.join(projectRoot, 'web', 'dist');
