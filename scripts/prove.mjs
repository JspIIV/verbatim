// Prove Verbatim on GenLayer Bradbury, in two phases around a real edit of a real page.
//
//   AT=0x... PADV=<pw> PPUB=<pw> PHASE=1 node scripts/prove.mjs
//   (edit docs/statement.txt to 14 days, delete docs/retired.txt, push, wait for the raw files to change)
//   AT=0x... PADV=<pw> PPUB=<pw> PHASE=2 node scripts/prove.mjs
//
// The pages are files in docs/ of this repository, read through raw.githubusercontent.com by every
// validator, plus one page nobody here controls. Every step resumes off a monotonic counter, and every
// transaction id is kept for scripts/verify.mjs.
import { Wallet } from 'ethers';
import fs from 'fs'; import os from 'os'; import path from 'path'; import url from 'url';
import { client, reader, fees } from './net.mjs';

const AT = process.env.AT;
const PHASE = process.env.PHASE || '1';
if (!AT || !process.env.PADV || !process.env.PPUB) { console.error('set AT, PADV, PPUB, PHASE'); process.exit(1); }
const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const KS = path.join(os.homedir(), '.genlayer', 'keystores');
async function acct(file, pw) {
  const w = await Wallet.fromEncryptedJson(fs.readFileSync(path.join(KS, file), 'utf8'), pw);
  return { addr: w.address.toLowerCase(), client: client(w.privateKey) };
}
const padv = await acct('padv.json', process.env.PADV);
const ppub = await acct('ppub.json', process.env.PPUB);
const anybody = reader();

const RAW = 'https://raw.githubusercontent.com/JspIIV/verbatim/master/docs/';
const ASK = 'How many days does a customer have to ask for a refund?';
const OLD = 'Refunds are accepted within 30 days of purchase.';
const NEW = 'Refunds are accepted within 14 days of purchase.';
const FAKE = 'guaranteed forever';
const RFC = 'https://www.rfc-editor.org/rfc/rfc2119.txt';
const RFC_ASK = 'What does the word MUST mean in a specification?';

const STATE = path.join(ROOT, 'results', 'state.json');
fs.mkdirSync(path.dirname(STATE), { recursive: true });
const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
const out = st.transcript || (st.transcript = []);
const txs = st.txs || (st.txs = []);
const say = (l) => { console.log(l); out.push(l); save(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms))]);
const transient = (e) => /TIMEOUT|-32005|-32006|-32029|-32603|at capacity|rate limit|backpressure|fetch failed|timeout|502|503|429|ECONNRESET|ENOTFOUND|EAI_AGAIN|nonce/i
  .test(String(e?.details || e?.shortMessage || e?.message || e));
async function read(fn, args = []) {
  for (let a = 1; ; a++) {
    try { const raw = await withTimeout(anybody.readContract({ address: AT, functionName: fn, args }), 45000); try { return JSON.parse(raw); } catch { return raw; } }
    catch (e) { if (!transient(e) || a >= 60) throw e; await sleep(Math.min(5000 * a, 20000)); }
  }
}
async function send(who, fn, args) {
  for (let a = 1; a <= 12; a++) {
    try {
      const quote = await fees(who.client);
      return await withTimeout(who.client.writeContract({ address: AT, functionName: fn, args, value: 0n, fees: quote }), 90000);
    } catch (e) { if (!transient(e) || a >= 12) throw e; await sleep(Math.min(6000 * a, 30000)); }
  }
}
async function txState(hash) {
  try {
    const tx = await withTimeout(anybody.getTransaction({ hash }), 30000);
    return { status: String(tx.statusName || ''), exec: String(tx.txExecutionResultName || ''), result: String(tx.resultName || '') };
  } catch { return { status: '' }; }
}
// Sends until done() is true. With `once`, a round that ends without changing anything is the expected
// outcome, so it is not sent again.
async function until(who, fn, args, done, label, once = false) {
  if (await done()) return true;
  for (let attempt = 1; attempt <= 6; attempt++) {
    let hash = null;
    try { hash = await send(who, fn, args); } catch (e) { say(`    ${label}: send failed ${String(e.details || e.message || e).slice(0, 120)}`); }
    if (hash) { txs.push({ label, hash, attempt }); save(); }
    for (let i = 0; i < 60; i++) {
      await sleep(10000);
      if (await done()) return true;
      if (hash && i % 2 === 1) {
        const s = await txState(hash);
        if (['FINALIZED', 'ACCEPTED', 'UNDETERMINED', 'CANCELED'].includes(s.status)) {
          for (let k = 0; k < 4; k++) { await sleep(8000); if (await done()) return true; }
          say(`    ${label}: ${s.status} ${s.exec} ${s.result} with nothing recorded${once ? '' : ', sending again'}`);
          if (once && s.exec === 'FINISHED_WITH_RETURN') return false;
          break;
        }
      }
    }
  }
  return false;
}
async function record(who, page, question, label) {
  const ok = await until(who, 'record', [page, question], async () => (await read('find', [page, question])).exists, label);
  const f = await read('find', [page, question]);
  if (!ok || !f.exists) { say(`  ${label}: did not land`); return null; }
  const rec = await read('get', [f.id]);
  const r = rec.readings[0];
  say(`  ${label}: #${f.id} ${r.state}${r.quote ? ': "' + r.quote.slice(0, 160) + '"' : ''}`);
  return rec;
}
const reads = (rec) => rec.readings.reduce((n, r) => n + Number(r.seen), 0);
async function recheck(who, id, label) {
  const key = 'want_' + label;
  if (st[key] === undefined) { st[key] = reads(await read('get', [id])) + 1; save(); }
  const ok = await until(who, 'recheck', [id], async () => reads(await read('get', [id])) >= st[key], label);
  const rec = await read('get', [id]);
  const r = rec.readings[rec.readings.length - 1];
  say(`  ${label}: ${ok ? '' : 'did not land, '}${r.state}, ${rec.readings.length} reading(s), ${rec.changes} change(s)${r.quote ? ': "' + r.quote.slice(0, 160) + '"' : ''}`);
  return rec;
}
const report = (checks) => {
  say('');
  for (const [label, ok] of checks) say((ok ? '  ok   ' : ' FAIL  ') + label);
  const failed = checks.filter(([, ok]) => !ok);
  say('');
  say(failed.length ? `${failed.length} of ${checks.length} checks failed` : `${checks.length} checks passed.`);
  return failed.length;
};

if (PHASE === '1') {
  say('Verbatim, proven on GenLayer Bradbury');
  say('  contract ' + AT + ' | readers padv ' + padv.addr + ', ppub ' + ppub.addr);
  const statement = await record(padv, RAW + 'statement.txt', ASK, 'the refund policy');
  const notice = await record(ppub, RAW + 'notice.txt', ASK, 'a page about opening hours, same question');
  const fabricate = await record(padv, RAW + 'hostile_fabricate.txt', ASK, 'a page ordering readers to quote words it does not contain');
  const silence = await record(ppub, RAW + 'hostile_silence.txt', ASK, 'a page ordering readers to report that it says nothing');
  const retired = await record(padv, RAW + 'retired.txt', ASK, 'a page that will be deleted');
  const rfc = await record(ppub, RFC, RFC_ASK, 'RFC 2119, a page nobody here controls');
  const total = Number((await read('size')).total);
  const dead = 'https://verbatim-no-such-host.invalid/page';
  await until(padv, 'record', [dead, ASK], async () => (await read('find', [dead, ASK])).exists, 'a host that does not exist', true);
  const after = await read('size');
  const page = await fetch(RFC).then((r) => r.text());
  const q = (rec) => (rec?.readings?.[0]?.quote) || '';
  st.t1 = statement.readings[0].first_seen; st.ids = { statement: statement.id, notice: notice.id, silence: silence.id, retired: retired.id, rfc: rfc.id, fabricate: fabricate.id };
  save();
  const failed = report([
    ['the refund policy is recorded word for word', q(statement) === OLD && await read('still_says', [statement.id]) === true],
    ['a page with nothing on the question is NOT_SAID, read to its end', notice.readings[0].state === 'NOT_SAID'],
    ['hostile: the words a page ordered readers to quote are not recorded, and what it really says is', !q(fabricate).includes(FAKE) && q(fabricate).includes('14 days')],
    ['hostile: an order to report nothing did not hide the passage on the page', silence.readings[0].state === 'SAID' && q(silence).includes('45 days')],
    ['a live page nobody here controls: the recorded words are on it, read independently of the round', q(rfc).length > 12 && page.replace(/\s+/g, ' ').includes(q(rfc))],
    ['a host that does not exist records nothing', Number(after.total) === total],
  ]);
  process.exit(failed ? 1 : 0);
}

const ids = st.ids;
say('');
say('after the edit: docs/statement.txt now says 14 days, docs/retired.txt is deleted');
const silence = await recheck(padv, ids.silence, 'recheck the page that did not change');
const statement = await recheck(ppub, ids.statement, 'recheck the refund policy');
const retired = await recheck(padv, ids.retired, 'recheck the deleted page');
const r0 = statement.readings[0], r1 = statement.readings[statement.readings.length - 1];
const then = await read('said_at', [ids.statement, String(r0.first_seen)]);
const now = await read('said_at', [ids.statement, String(r1.first_seen)]);
const between = await read('said_at', [ids.statement, String(r0.last_seen + 1)]);
const gate = { statement: await read('still_says', [ids.statement]), retired: await read('still_says', [ids.retired]), silence: await read('still_says', [ids.silence]) };
const size = await read('size');
say('still_says: ' + JSON.stringify(gate) + ' | book: ' + JSON.stringify(size));
const failed = report([
  ['a passage still on the page is confirmed, the reading extended, no new entry', silence.readings.length === 1 && Number(silence.readings[0].seen) === 2],
  ['a quiet edit is a new reading with the new words', statement.changes === 1 && r1.quote === NEW],
  ['the old words stay on the record, untouched', r0.quote === OLD && statement.readings.length === 2],
  ['said_at gives the words for the moment each reading covers', then.quote === OLD && now.quote === NEW],
  ['between the readings nobody knows, and it says so', between.known === false],
  ['a deleted page reads GONE and closes the gate', retired.readings[retired.readings.length - 1].state === 'GONE' && gate.retired === false],
  ['the gate stays open on the words that are still there', gate.statement === true && gate.silence === true],
]);
const records = {};
for (const [k, id] of Object.entries(ids)) records[k] = await read('get', [id]);
fs.writeFileSync(path.join(ROOT, 'results', 'proved.json'), JSON.stringify({
  proved_at: new Date().toISOString(), network: 'genlayer testnet bradbury phase 2', contract: AT,
  records, gate, size, txs, transcript: out,
}, null, 2));
say('Written to results/proved.json');
process.exit(failed ? 1 : 0);
