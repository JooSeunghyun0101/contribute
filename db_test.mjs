import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env');
let connectionString;
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [key, ...rest] = trimmed.split('=');
    if (key === 'DATABASE_URL') {
        connectionString = rest.join('=');
    }
  });
}

console.log('Testing connection to:', connectionString);
const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });

pool.query('SELECT 1')
  .then(() => {
    console.log('✅ Success!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
  });
