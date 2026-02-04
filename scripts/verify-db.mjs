#!/usr/bin/env node
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

console.log('🔍 Checking database state...\n');

const sql = neon(DATABASE_URL);

try {
  // Check businesses
  const businesses = await sql`SELECT COUNT(*) as count FROM businesses`;
  console.log(`✅ Businesses: ${businesses[0].count}`);

  // Check if business_members table exists
  const tableCheck = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'business_members'
    ) as exists
  `;

  if (tableCheck[0].exists) {
    console.log('⚠️  business_members table already exists!');
    const members = await sql`SELECT COUNT(*) as count FROM business_members`;
    console.log(`   Members: ${members[0].count}`);
  } else {
    console.log('✅ business_members table does not exist (ready for migration)');
  }

  // Check if event_outbox table exists
  const eventTableCheck = await sql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'event_outbox'
    ) as exists
  `;

  if (eventTableCheck[0].exists) {
    console.log('⚠️  event_outbox table already exists!');
    const events = await sql`SELECT COUNT(*) as count FROM event_outbox`;
    console.log(`   Events: ${events[0].count}`);
  } else {
    console.log('✅ event_outbox table does not exist (ready for migration)');
  }

  // Check timestamp types
  const timestampCheck = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'businesses'
    AND column_name IN ('created_at', 'updated_at')
  `;

  console.log('\n📅 Timestamp types in businesses table:');
  timestampCheck.forEach(col => {
    console.log(`   ${col.column_name}: ${col.data_type}`);
  });

  console.log('\n✅ Database verification complete!');

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
