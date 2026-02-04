#!/usr/bin/env node
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

console.log('🚀 Migrating existing owners to business_members...\n');

const sql = neon(DATABASE_URL);

try {
  // Migrate existing owners
  await sql`
    INSERT INTO business_members (business_id, clerk_user_id, role, status, joined_at, created_at, updated_at)
    SELECT
      id as business_id,
      clerk_user_id,
      'owner' as role,
      'active' as status,
      created_at as joined_at,
      created_at,
      now() as updated_at
    FROM businesses
    WHERE clerk_user_id IS NOT NULL
    ON CONFLICT (business_id, clerk_user_id) DO NOTHING
  `;

  console.log('✅ Owners migrated successfully!\n');

  // Verify
  const count = await sql`SELECT COUNT(*) as count FROM business_members`;
  console.log(`📊 Total members: ${count[0].count}`);

  const owners = await sql`
    SELECT b.name, bm.role, bm.status
    FROM businesses b
    JOIN business_members bm ON b.id = bm.business_id
    WHERE bm.role = 'owner'
  `;

  console.log('\n👥 Migrated owners:');
  owners.forEach(o => {
    console.log(`   ✓ ${o.name} (${o.role}, ${o.status})`);
  });

  console.log('\n🎉 Data migration complete!\n');

} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  process.exit(1);
}
