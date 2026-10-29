import { execFileSync, spawnSync } from 'node:child_process';

const apps = process.argv.slice(2);
if (apps.length < 2) throw new Error('Provide two signed app builds to compare.');
// codesign writes successful inspection to stderr, so collect it without exposing certificate details.
const identities = apps.map(app => {
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
  const result = spawnSync('codesign', ['-d','-r-',app], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('SIGNATURE_INSPECTION_FAILED');
  const line = (result.stdout + result.stderr).split('\n').find(line => /^(?:# )?designated => /.test(line));
  if (!line) throw new Error('DESIGNATED_REQUIREMENT_MISSING');
  return line.replace(/^(?:# )?designated => /,'');
});
if (identities.some(identity => /^cdhash\b/.test(identity))) throw new Error('UNSTABLE_AD_HOC_KEYCHAIN_IDENTITY');
if (identities.some(identity => identity !== identities[0])) throw new Error('KEYCHAIN_IDENTITY_CHANGED_BETWEEN_BUILDS');
console.log(`PASS: ${apps.length} independently sealed builds retain the same certificate-backed designated requirement. Keychain access also depends on the stored item's permissions and an actual read.`);
