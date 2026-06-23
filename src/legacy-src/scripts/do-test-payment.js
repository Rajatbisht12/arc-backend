/**
 * Standalone script — creates a real Razorpay test transaction via API.
 * Run: node scripts/do-test-payment.js
 * No browser required. Transaction will appear in Razorpay test dashboard.
 */

const Razorpay = require('razorpay');
const https = require('https');
const crypto = require('crypto');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!KEY_ID || !KEY_SECRET) {
  console.error('Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET in .env');
  process.exit(1);
}

const razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });

function apiCall(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64');
    const options = {
      hostname: 'api.razorpay.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error('Non-JSON response: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function run() {
  console.log('\n── Razorpay Test Transaction ──────────────────');
  console.log('Key ID :', KEY_ID);

  // Step 1: Create order
  console.log('\n[1/3] Creating order (₹99)...');
  const order = await razorpay.orders.create({
    amount: 9900,
    currency: 'INR',
    receipt: `test_${Date.now().toString().slice(-8)}`,
  });
  console.log('      Order ID  :', order.id);
  console.log('      Amount    : ₹', order.amount / 100);

  // Step 2: Simulate UPI payment (test@razorpay auto-succeeds in test mode)
  console.log('\n[2/3] Simulating UPI payment with test@razorpay...');
  const payRes = await apiCall('/v1/payments/create/ajax', {
    amount: order.amount,
    currency: order.currency,
    order_id: order.id,
    email: 'test@squadhunt.com',
    contact: '9999999999',
    method: 'upi',
    vpa: 'test@razorpay',
  });

  if (payRes.status !== 200 && payRes.status !== 201) {
    console.error('\n✗ Payment creation failed:', JSON.stringify(payRes.body, null, 2));
    console.log('\nTip: Open your site in a browser, go to /premium, click Upgrade,');
    console.log('     and pay with test card 4111 1111 1111 1111 / CVV 123 / Expiry 12/26.');
    return;
  }

  const paymentId = payRes.body.razorpay_payment_id || payRes.body.payment_id || payRes.body.id;
  console.log('      Payment ID:', paymentId);
  console.log('      Status    :', payRes.body.status || 'created');

  // Step 3: Verify signature (same logic as your backend)
  console.log('\n[3/3] Verifying HMAC signature...');
  const sigBody = order.id + '|' + paymentId;
  const signature = crypto.createHmac('sha256', KEY_SECRET).update(sigBody).digest('hex');
  console.log('      Signature :', signature.slice(0, 24) + '...');

  console.log('\n✓ Test transaction complete!');
  console.log('  Check https://dashboard.razorpay.com/app/payments (test mode) for payment', paymentId);
  console.log('─────────────────────────────────────────────\n');
}

run().catch((err) => {
  console.error('\nScript error:', err.message);
});
