import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Keep test runs from reading or writing the repo's real workflows/logs/metrics
process.env.FACTORY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-test-'));
// Plan approval is on by default for real runs. Tests that do not exercise it run straight through; the ones that do set it themselves.
process.env.FACTORY_PLAN_APPROVAL = '0';
