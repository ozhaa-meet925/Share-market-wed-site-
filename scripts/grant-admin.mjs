// Local operator tool: grant the admin role when no admin exists yet.
// Usage: npm run admin:grant -- <phone-or-user-id>
// This edits data/users.json through the same validated role logic the API uses.
import { changeAuthUserRole, listAuthUsersForAdmin } from '../serverAuth.js';

const target = String(process.argv[2] || '').trim();
if (!target) {
  console.error('Usage: npm run admin:grant -- <10-digit-phone-or-user-id>');
  console.error('This command refuses to run without a target so no account is promoted by accident.');
  process.exit(1);
}

const users = listAuthUsersForAdmin();
const match = users.find((user) => user.id === target || user.phone === target);
if (!match) {
  console.error(`No account matches "${target}". Known accounts:`);
  for (const user of users) console.error(`- ${user.id} · ${user.phone} · ${user.name || 'unnamed'} · ${user.role}`);
  process.exit(1);
}

const result = changeAuthUserRole(match.id, 'admin', 'cli-operator');
const admins = listAuthUsersForAdmin().filter((user) => user.role === 'admin').length;
console.log(`${match.name || match.id} (${match.phone}) is now ${result.role}. Admin accounts: ${admins}.`);
console.log('Restart the server if it is already running so it reloads the account store.');
