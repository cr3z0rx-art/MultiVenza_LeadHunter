require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function run() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase
    .from('leads')
    .select('state');

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  const counts = data.reduce((acc, l) => {
    const s = l.state || 'Unknown';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  console.log('--- REPORTE DE LEADS NO-GC ---');
  console.table(counts);
  console.log('Total:', data.length);
}

run();
