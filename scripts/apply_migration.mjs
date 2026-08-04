import pg from 'pg';
import fs from 'fs';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.nijjlcrricrmnlpwdjgx:KlyWoaGrl8PSBXsh@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres'
});

async function run() {
  await client.connect();
  try {
    const sql = fs.readFileSync('supabase/migrations/20260803203600_fix_pay_for_expired_preview.sql', 'utf8');
    await client.query(sql);
    console.log('Migration applied successfully');
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}

run();
