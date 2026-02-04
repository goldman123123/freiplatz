#!/usr/bin/env node
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

console.log('🚀 Applying Migration 0001: Platform Spine\n');

const sql = neon(DATABASE_URL);

try {
  // Read migration file
  const migrationPath = join(__dirname, '../drizzle/0001_true_phantom_reporter.sql');
  const migrationSQL = readFileSync(migrationPath, 'utf8');

  // Split into individual statements
  const statements = migrationSQL
    .split('--> statement-breakpoint')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`📄 Executing ${statements.length} statements...\n`);

  let successful = 0;
  let skipped = 0;

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];

    try {
      await sql.unsafe(statement);
      successful++;

      // Log key operations
      if (statement.includes('CREATE TABLE "business_members"')) {
        console.log('✅ Created business_members table');
      } else if (statement.includes('CREATE TABLE "event_outbox"')) {
        console.log('✅ Created event_outbox table');
      } else if (statement.includes('INSERT INTO "business_members"')) {
        console.log('✅ Migrated existing owners to business_members');
      } else if (statement.includes('btree_gist')) {
        console.log('✅ Enabled btree_gist extension');
      } else if (statement.includes('no_overlapping_bookings')) {
        console.log('✅ Added double-booking protection');
      } else if (statement.includes('plan_id')) {
        console.log('✅ Added plan fields');
      }
    } catch (error) {
      // Handle expected errors (already exists, etc.)
      if (error.message.includes('already exists') || error.message.includes('duplicate')) {
        skipped++;
        // Don't log every timestamp conversion skip
        if (!statement.includes('SET DATA TYPE timestamp')) {
          console.log(`⏭️  Skipped (already exists): ${statement.substring(0, 50)}...`);
        }
      } else {
        throw error;
      }
    }
  }

  console.log(`\n✅ Migration complete! (${successful} applied, ${skipped} skipped)\n`);

  // Wait a moment for changes to propagate
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Verify migration with fresh connection
  console.log('🔍 Verifying...');

  const sqlVerify = neon(DATABASE_URL);

  const memberCount = await sqlVerify`SELECT COUNT(*) as count FROM business_members`;
  console.log(`   ✅ business_members: ${memberCount[0].count} members`);

  const eventCount = await sqlVerify`SELECT COUNT(*) as count FROM event_outbox`;
  console.log(`   ✅ event_outbox: ${eventCount[0].count} events`);

  const timestampCheck = await sqlVerify`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'created_at'
  `;
  console.log(`   ✅ Timestamp type: ${timestampCheck[0].data_type}`);

  const planCheck = await sqlVerify`
    SELECT COUNT(*) as count FROM information_schema.columns
    WHERE table_name = 'businesses' AND column_name = 'plan_id'
  `;
  console.log(`   ✅ Plan fields: ${planCheck[0].count > 0 ? 'Added' : 'Not found'}`);

  console.log('\n🎉 Migration successful!\n');

} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error(error);
  process.exit(1);
}
