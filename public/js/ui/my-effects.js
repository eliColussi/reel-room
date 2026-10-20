// "My effects": effects the user keeps for every future video. Saving reads the effect's meta in
// the browser (where effect code already runs) and stores code + meta in the Reel Room folder.
import { api, toast, prompt, confirmBox } from '../lib.js';

const pretty = (file) => file.split('/').pop().replace(/\.js$/, '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 50) || 'effect';

export async function effectName(ed, file) {
  try { return (await ed.assets.module(ed.assets.url(file))).meta?.name || null; } catch { return null; }
}

export async function saveEffectToLibrary(ed, file) {
  const url = ed.assets.url(file);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) { toast('That effect file is gone. Ask the AI to make it again.', 'error'); return false; }
  const code = await res.text();
  let meta = {};
  try { meta = (await ed.assets.module(url)).meta || {}; } catch (e) { toast(`This effect has an error, so it can't be saved yet: ${e.message}`, 'error', 6000); return false; }
  const name = await prompt('Save to my effects', meta.name || pretty(file));
  if (!name) return false;
  const slug = slugify(name);
  const mine = await api.get('/api/my-effects').catch(() => []);
  if (mine.some((e) => e.file === `mine/${slug}.js`) && !(await confirmBox('Replace it?', `You already have an effect called "${name}". Replace it with this one?`, 'Replace'))) return false;
  const clean = JSON.parse(JSON.stringify({ ...meta, name }));
  await api.put(`/api/my-effects/${slug}`, { code, meta: clean, from: ed.project.name });
  ed.panels?.effects?.refresh?.();
  toast(`Saved "${name}". Every video can use it now, and the AI knows it's one of your favourites.`, 'ok', 5000);
  return true;
}

export async function deleteMyEffect(e) {
  if (!(await confirmBox('Delete this effect?', `"${e.name}" will be removed from your effects. Any video that uses it will stop showing it.`, 'Delete'))) return false;
  await api.del(`/api/my-effects/${e.file.split('/').pop().replace(/\.js$/, '')}`);
  return true;
}
