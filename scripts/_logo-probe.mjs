import axios from 'axios';
import { detectImage, logoSources } from '../serverCompanyLogos.js';
const domains = process.argv.slice(2);
for (const d of domains) {
  const row = [];
  for (const url of logoSources(d)) {
    try {
      const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000, validateStatus: () => true, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' } });
      const img = detectImage(Buffer.from(r.data));
      row.push(`${new URL(url).hostname.split('.')[0]}:${r.status}:${img ? img.type.split('/')[1] + ' ' + img.width : 'none'}:${r.data.byteLength}`);
    } catch (e) { row.push(`${new URL(url).hostname.split('.')[0]}:ERR`); }
  }
  console.log(d.padEnd(22), row.join(' | '));
}
