import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

if (process.platform !== 'darwin') throw new Error('This private Inspector package requires macOS signing.');
const file = path.resolve('electron-builder.local-signing.json');
let config;
try { config = JSON.parse(readFileSync(file,'utf8')); }
catch { throw new Error('Configure an existing code-signing certificate in the ignored electron-builder.local-signing.json first.'); }
const hash = config.mac?.identity;
if (config.extends !== './electron-builder.inspector.yml' || !['development','distribution'].includes(config.mac?.type) || typeof hash !== 'string' || !/^[a-f0-9]{40}$/i.test(hash)) throw new Error('INVALID_LOCAL_SIGNING_CONFIG');
const identities = execFileSync('security',['find-identity','-v','-p','codesigning'],{encoding:'utf8'});
const matching = identities.split('\n').find(line => line.includes(hash));
if (!matching || !/"(?:Apple Development|Developer ID Application):/.test(matching)) throw new Error('CONFIGURED_SIGNING_CERTIFICATE_UNAVAILABLE');
const result = spawnSync(process.execPath,[path.resolve('node_modules/electron-builder/cli.js'),'--config',file,'--mac','dir','--arm64','--publish','never'],{stdio:'inherit'});
if (result.status !== 0) process.exit(result.status ?? 1);
const app = path.resolve('release-inspector/mac-arm64/Agent Monitor Token Inspector.app');
execFileSync('codesign',['--verify','--deep','--strict',app],{stdio:'pipe'});
const inspected = spawnSync('codesign',['-d','-r-',app],{encoding:'utf8'});
const requirement = (inspected.stdout + inspected.stderr).split('\n').find(line => /^(?:# )?designated => /.test(line));
if (inspected.status !== 0 || !requirement || requirement.includes('=> cdhash ') || !requirement.includes('identifier "com.gavinho.agentmonitor.inspector"')) throw new Error('UNSTABLE_INSPECTOR_SIGNING_IDENTITY');
console.log('PASS: Inspector is signed by the configured existing certificate; no ad-hoc fallback.');
