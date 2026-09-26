// Published recordings live in a Vercel Blob store, not in git (decision 40).
// The lab and arrangement reports are the manifest: every FLAC they name is
// stored under its site path, and every path names its content - the lab's
// by engine version and PCM hash, the arrangements' by a prefix of the FLAC's
// own hash. A key is written once and never changes, so the site rewrites
// those paths to the store and browsers may keep a file for a year.
//
//   pnpm audio:pull    a verified local copy under apps/web/public
//   pnpm audio:check   every published recording is in the store
//   pnpm audio:push    upload what is missing (needs BLOB_READ_WRITE_TOKEN)
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const web=resolve(import.meta.dirname,'..'),root=resolve(web,'../..');
export const {base}=JSON.parse(await readFile(resolve(web,'audio-store.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const labName=/^\/lab-data\/[0-9a-f]{12}\/([0-9a-f]{64})\.flac$/,arrangementName=/^\/arrangement-data\/[a-z0-9-]+-([0-9a-f]{12})\.flac$/;
const local=file=>resolve(web,'public'+file);
async function each(items,task,width=8){const queue=[...items];await Promise.all(Array.from({length:width},async()=>{while(queue.length)await task(queue.shift());}));}
// A dropped connection or a busy edge is retried with backoff; a 404 is an
// answer and is not.
async function request(url,init,attempts=5){
 for(let attempt=1;;attempt++){
  try{const response=await fetch(url,init);if(response.status<500&&response.status!==429||attempt===attempts)return response;}
  catch(error){if(attempt===attempts)throw error;}
  await new Promise(done=>setTimeout(done,500*2**attempt));
 }
}

// Every recording the two reports publish, by site path, with the SHA-256 of
// its bytes. A path that does not name its content is refused before it can
// become a store key that would one day need to change.
export async function publishedRecordings(){
 const recordings=new Map();
 const add=({file,sha256,sourceWavSha256})=>{
  const [,pcm]=labName.exec(file)??[],[,prefix]=arrangementName.exec(file)??[];
  if(!(pcm&&pcm===sourceWavSha256)&&!(prefix&&sha256.startsWith(prefix)))throw new Error(`${file} does not name its content`);
  if(recordings.has(file)&&recordings.get(file)!==sha256)throw new Error(`${file} is published with two different contents`);
  recordings.set(file,sha256);
 };
 const lab=JSON.parse(await readFile(local('/lab-data/report.json'),'utf8'));
 for(const row of lab.cases)for(const collection of [row.assets,row.baseline??{}])for(const entry of Object.values(collection))add(entry);
 const arrangements=JSON.parse(await readFile(local('/arrangement-data/report.json'),'utf8'));
 for(const piece of arrangements.pieces){for(const row of piece.cases)add(row.asset);if(piece.reference)add(piece.reference.asset);}
 return recordings;
}

async function localCopy(file,sha256){
 try{const bytes=await readFile(local(file));return hash(bytes)===sha256?bytes:null;}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function download(file,sha256){
 const response=await request(base+file);
 if(!response.ok)throw new Error(`${file}: the store answered ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(hash(bytes)!==sha256)throw new Error(`${file}: the stored bytes are not the ones the report names`);
 return bytes;
}
// One recording's published bytes, verified: the local copy when it is there
// and intact, the store's otherwise.
export async function publishedBytes(file,sha256){return await localCopy(file,sha256)??await download(file,sha256);}

export async function pull(){
 const recordings=await publishedRecordings();let fetched=0;
 await each(recordings,async([file,sha256])=>{
  if(await localCopy(file,sha256))return;
  const bytes=await download(file,sha256),target=local(file);
  await mkdir(dirname(target),{recursive:true});await writeFile(target+'.tmp',bytes);await rename(target+'.tmp',target);fetched++;
 });
 console.log(`PASS ${recordings.size} published recordings verified locally; ${fetched} fetched from the store`);
}

export async function check(){
 const recordings=await publishedRecordings(),missing=[];
 await each(recordings,async([file])=>{const response=await request(base+file,{method:'HEAD'});if(!response.ok)missing.push(`${file} (${response.status})`);});
 if(missing.length)throw new Error(`Not in the store; run pnpm audio:push:\n${missing.sort().join('\n')}`);
 console.log(`PASS the store holds all ${recordings.size} published recordings`);
}

export async function push(){
 for(const file of [resolve(root,'.env.local'),resolve(web,'.env.local')])if(!process.env.BLOB_READ_WRITE_TOKEN)try{process.loadEnvFile(file);}catch{}
 const token=process.env.BLOB_READ_WRITE_TOKEN;
 if(!token)throw new Error('Uploading needs BLOB_READ_WRITE_TOKEN: run `vercel env pull .env.local --environment=development` at the repository root');
 const {put,head,BlobNotFoundError}=await import('@vercel/blob');
 const recordings=await publishedRecordings();let uploaded=0;
 await each(recordings,async([file,sha256])=>{
  const bytes=await localCopy(file,sha256);
  let stored=null;try{stored=await head(file.slice(1),{token});}catch(error){if(!(error instanceof BlobNotFoundError))throw error;}
  if(stored){if(bytes&&stored.size!==bytes.length)throw new Error(`${file} is already stored with other bytes; run pnpm audio:pull and publish again`);return;}
  if(!bytes)throw new Error(`${file} is neither in the store nor intact under apps/web/public`);
  await put(file.slice(1),bytes,{access:'public',contentType:'audio/flac',cacheControlMaxAge:31536000,token});uploaded++;
 });
 console.log(`PASS ${uploaded} recordings uploaded; ${recordings.size-uploaded} were already stored`);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const command={pull,check,push}[process.argv[2]];
 if(!command){console.error('Usage: audio-store.mjs pull|check|push');process.exit(2);}
 await command();
}
