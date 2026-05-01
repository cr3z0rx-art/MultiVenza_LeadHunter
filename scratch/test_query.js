const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testQuery() {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  
  console.log("Checking competitor_analysis...");
  const comp = await supabase.from('competitor_analysis').select('state').gte('permit_date', cutoff);
  console.log("Competitor data length:", comp.data?.length, "Error:", comp.error);
  
  console.log("Checking leads...");
  const leads = await supabase.from('leads').select('state').or('tier.eq.diamante,no_gc.eq.true');
  console.log("Leads data length:", leads.data?.length, "Error:", leads.error);
}

testQuery();
