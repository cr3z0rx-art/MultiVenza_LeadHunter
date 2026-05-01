const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectSchema() {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error fetching leads:', error);
    return;
  }

  if (data.length === 0) {
    console.log('Table is empty!');
    return;
  }

  console.log('Columns found:', Object.keys(data[0]));
  console.log('Sample data:', data[0]);
}

inspectSchema();
