const https = require('https');

const data = JSON.stringify({
  source_state: 'FL',
  batch_id: 'TEST-SMOKE-MANUAL',
  leads: [
    {
      city: "Orlando",
      zip_code: "32801",
      state: "FL",
      county: "Orange",
      project_type: "Roofing",
      estimated_valuation: 20000,
      tier: "STANDARD",
      score: 70,
      tags: [],
      no_gc: true,
      exact_address: "100 ORLANDO AVE, Orlando, FL, 32801",
      owner_name: "Jones Bob",
      permit_number: "ORAN-2024-TEST",
      processed_at: new Date().toISOString()
    }
  ]
});

const options = {
  hostname: 'multivenzaleadhunter.vercel.app',
  path: '/api/sync',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'x-api-key': 'MultiVenza_Secret_2026'
  }
};

const req = https.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.write(data);
req.end();
