const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SENDGRID_API_KEY) {
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  } else {
    // Fallback: log emails to console
    transporter = {
      sendMail: async (options) => {
        console.log('Email (no SendGrid configured):', JSON.stringify(options, null, 2));
        return { messageId: 'console-' + Date.now() };
      },
    };
  }

  return transporter;
}

async function sendMigrationReport(to, migration) {
  const transport = getTransporter();

  const categoryRows = migration.diff_report
    ? Object.entries(migration.diff_report)
        .map(([cat, data]) => `<tr><td style="padding:8px;border:1px solid #ddd">${cat}</td><td style="padding:8px;border:1px solid #ddd">${data.source}</td><td style="padding:8px;border:1px solid #ddd">${data.destination}</td><td style="padding:8px;border:1px solid #ddd">${data.match ? '✅' : '⚠️'}</td></tr>`)
        .join('')
    : '<tr><td colspan="4">No report available</td></tr>';

  await transport.sendMail({
    from: process.env.FROM_EMAIL || 'noreply@guestymigrate.com',
    to,
    subject: `GuestyMigrate — Migration ${migration.status === 'complete' ? 'Complete' : 'Report'}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#4f46e5">GuestyMigrate Report</h2>
        <p>Your migration <strong>${migration.id}</strong> is now <strong>${migration.status}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Category</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Source</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Destination</th>
              <th style="padding:8px;border:1px solid #ddd;text-align:left">Match</th>
            </tr>
          </thead>
          <tbody>
            ${categoryRows}
          </tbody>
        </table>
        <p style="margin-top:16px;color:#6b7280;font-size:14px">Thank you for using GuestyMigrate.</p>
      </div>
    `,
  });
}

module.exports = { sendMigrationReport };
