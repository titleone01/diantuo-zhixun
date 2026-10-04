import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
export default class SanitizedReporter {
  results = [];
  privateFailures = [];
  onTestEnd(test, result) {
    this.results.push({ title: test.title, status: result.status, durationMs: result.duration, errors: result.errors.map(error => ({ name: error.name || 'TestFailure' })) });
    console.log(`[browser] ${result.status}: ${test.title}`);
    if (result.errors.length) this.privateFailures.push({ title: test.title, errors: result.errors });
  }
  async onEnd(result) {
    const directory = path.resolve('.local/acceptance-public'); await mkdir(directory, { recursive: true });
    const report = { at: new Date().toISOString(), status: result.status, browser: 'Chromium', workers: 1, scope: 'isolated fixture accounts, no production data', tests: this.results };
    const bytes = JSON.stringify(report, null, 2);
    await writeFile(path.join(directory, 'browser.json'), bytes);
    const history = path.join(directory, 'browser-history'); await mkdir(history, { recursive: true });
    await writeFile(path.join(history, report.at.replaceAll(':', '-').replaceAll('.', '-') + '.json'), bytes, { flag: 'wx' });
    // Detailed failures stay with synthetic fixture credentials, outside the CI upload directory.
    const privateDirectory = process.env.DIANTUO_BROWSER_PRIVATE_OUTPUT;
    if (privateDirectory && this.privateFailures.length) {
      await mkdir(privateDirectory, { recursive: true });
      await writeFile(path.join(privateDirectory, 'failures.json'), JSON.stringify(this.privateFailures, null, 2), { mode: 0o600 });
    }
  }
}
