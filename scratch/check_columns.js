const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkColumns() {
  const { data: cols, error } = await supabase
    .rpc('get_table_columns', { table_name: 'leads' }); // Custom RPC or fallback

  if (error) {
     // Fallback: select one record
     const { data, error: err2 } = await supabase.from('leads').select('*').limit(1);
     if (err2) {
       console.error(err2);
       return;
     }
     console.log('Columns:', Object.keys(data[0] || {}));
  } else {
    console.log('Columns:', cols);
  }
}

checkColumns();
