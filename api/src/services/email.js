const https = require('https');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@macromirco.com';
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'admin@macromirco.com';

/**
 * Send an email via Resend REST API (no extra dependencies needed).
 */
function sendEmail({ to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    if (!RESEND_API_KEY) {
      return reject(new Error('RESEND_API_KEY not configured'));
    }

    const payload = JSON.stringify({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
      html,
    });

    const options = {
      hostname: 'api.resend.com',
      port: 443,
      path: '/emails',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch {
            resolve(data);
          }
        } else {
          reject(new Error(`Resend API error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Send a bug-report alert to the admin inbox.
 */
async function sendBugReportAlert({ userId, title, description, reportId }) {
  const subject = `[Bug Report #${reportId}] ${title}`;
  const text = `User: ${userId}\nTitle: ${title}\nDescription: ${description || '(no description)'}`;
  const html = `
    <h2>New Bug Report #${reportId}</h2>
    <p><strong>User:</strong> ${userId}</p>
    <p><strong>Title:</strong> ${title}</p>
    <p><strong>Description:</strong></p>
    <pre>${description || '(no description)'}</pre>
  `;
  return sendEmail({ to: ALERT_EMAIL, subject, text, html });
}

module.exports = { sendEmail, sendBugReportAlert };
