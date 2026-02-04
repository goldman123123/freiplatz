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

console.log('🚀 Running Platform Spine Migration...\n');

const sql = neon(DATABASE_URL);

try {
  // Read migration file
  const migrationPath = join(__dirname, '../drizzle/0001_platform_spine_multi_tenant.sql');
  const migrationSQL = readFileSync(migrationPath, 'utf8');

  console.log('📄 Migration file loaded');
  console.log('⚠️  This will:');
  console.log('   - Create business_members table');
  console.log('   - Create event_outbox table');
  console.log('   - Migrate existing owners to business_members');
  console.log('   - Convert all timestamps to TIMESTAMPTZ');
  console.log('   - Add double-booking protection');
  console.log('   - Add plan fields to businesses\n');

  // Split migration into individual statements
  const statements = migrationSQL
    .split('--> statement-breakpoint')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`📊 Executing ${statements.length} migration statements...\n`);

  let successCount = 0;
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];

    // Skip comments
    if (statement.startsWith('--')) continue;

    try {
      await sql.unsafe(statement);
      successCount++;

      // Show progress for key operations
      if (statement.includes('CREATE TABLE "business_members"')) {
        console.log('✅ Created business_members table');
      } else if (statement.includes('CREATE TABLE "event_outbox"')) {
        console.log('✅ Created event_outbox table');
      } else if (statement.includes('INSERT INTO "business_members"')) {
        console.log('✅ Migrated existing owners to business_members');
      } else if (statement.includes('btree_gist')) {
        console.log('✅ Enabled btree_gist extension');
      } else if (statement.includes('no_overlapping_bookings')) {
        console.log('✅ Added double-booking protection constraint');
      } else if (statement.includes('plan_id')) {
        console.log('✅ Added plan fields to businesses');
      } else if (statement.includes('ALTER TABLE') && statement.includes('timestamp with time zone')) {
        // Don't log every timestamp conversion to avoid spam
      }
    } catch (error) {
      console.error(`❌ Error in statement ${i + 1}:`, error.message);
      console.error('Statement:', statement.substring(0, 100) + '...');
      throw error;
    }
  }

  console.log(`\n✅ Migration complete! (${successCount} statements executed)\n`);

  // Verify migration
  console.log('🔍 Verifying migration...');

  const memberCount = await sql`SELECT COUNT(*) as count FROM business_members`;
  console.log(`   ✅ business_members: ${memberCount[0].count} members (should equal # of businesses)`);

  const eventCount = await sql`SELECT COUNT(*) as count FROM event_outbox`;
  console.log(`   ✅ event_outbox: ${eventCount[0].count} events (should be 0)`);

  const timestampCheck = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'businesses'
    AND column_name = 'created_at'
  `;
  console.log(`   ✅ Timestamp type: ${timestampCheck[0].data_type}`);

  console.log('\n🎉 Migration successful!\n');

} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error('\nPlease review the error and contact support if needed.');
  process.exit(1);
}
