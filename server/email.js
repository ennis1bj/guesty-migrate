let resendClient = null;

function getClient() {
  if (resendClient) return resendClient;

  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  } else {
    // Fallback: log emails to console
    resendClient = {
      emails: {
        send: async (options) => {
          console.log('Email (no Resend configured):', JSON.stringify(options, null, 2));
          return { id: 'console-' + Date.now() };
        },
      },
    };
  }

  return resendClient;
}

async function sendMigrationReport(to, migration) {
  const client = getClient();

  const categoryRows = migration.diff_report
    ? Object.entries(migration.diff_report)
        .map(([cat, data]) => {
          if (cat === 'photos') {
            return `<tr>
              <td style="padding:8px;border:1px solid #ddd">📷 Photos</td>
              <td style="padding:8px;border:1px solid #ddd">${data.found ?? '-'} found</td>
              <td style="padding:8px;border:1px solid #ddd">${data.migrated ?? '-'} migrated</td>
              <td style="padding:8px;border:1px solid #ddd">${data.failed ? '⚠️ ' + data.failed + ' failed' : '✅'}</td>
            </tr>`;
          }
          return `<tr>
            <td style="padding:8px;border:1px solid #ddd">${cat}</td>
            <td style="padding:8px;border:1px solid #ddd">${data.source}</td>
            <td style="padding:8px;border:1px solid #ddd">${data.destination}</td>
            <td style="padding:8px;border:1px solid #ddd">${data.match ? '✅' : '⚠️'}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="4">No report available</td></tr>';

  await client.emails.send({
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
