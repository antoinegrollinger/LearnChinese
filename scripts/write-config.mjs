/* Run after "ng build": writes dist/hanzi-workshop/browser/config.json from the API_URL environment
 * variable, so a host that builds from git (e.g. Hostinger) gets the right API address.
 * Without API_URL, public/config.json is kept as is ("apiUrl": "" = same server as the app). */
import { writeFileSync } from 'node:fs';

const apiUrl = (process.env.API_URL ?? '').trim().replace(/\/+$/, '');
if (apiUrl) {
  writeFileSync('dist/hanzi-workshop/browser/config.json', JSON.stringify({ apiUrl }, null, 2) + '\n');
  console.log(`config.json: apiUrl = ${apiUrl}`);
}
