const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function countByState() {
  const { data, error } = await supabase
    .from('leads')
    .select('state');

  if (error) {
    console.error(error);
    return;
  }

  const counts = data.reduce((acc, lead) => {
    acc[lead.state] = (acc[lead.state] || 0) + 1;
    return acc;
  }, {});

  console.log('Leads by State:', counts);
  console.log('Total Leads:', data.length);
}

countByState();
