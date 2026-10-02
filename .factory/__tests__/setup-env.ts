import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Keep test runs from reading or writing the repo's real workflows/logs/metrics
process.env.FACTORY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-test-'));
