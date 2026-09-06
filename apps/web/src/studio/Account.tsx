'use client';
import { useEffect, useState } from 'react';
type Library = {email:string;songs:{id:string;title:string|null}[]};
type Key = {id:string;label:string|null;revoked_at:number|null};

/** Account tools stay inside sharing; playing and saving drafts need no login. */
export function Account() {
  const [library,setLibrary] = useState<Library|null>(null);
  const [keys,setKeys] = useState<Key[]>([]);
  const [email,setEmail] = useState('');
  const [busy,setBusy] = useState(true);
  const [message,setMessage] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/me', {signal:abort.signal});
        if (response.ok) {
          setLibrary(await response.json());
          const keyResponse = await fetch('/api/keys', {signal:abort.signal});
          if (keyResponse.ok) setKeys((await keyResponse.json()).keys);
        } else if (response.status !== 401) setMessage('Accounts are unavailable right now. Your local draft is safe.');
      } catch { if (!abort.signal.aborted) setMessage('Could not reach your library.'); }
      finally { if (!abort.signal.aborted) setBusy(false); }
    })();
    return () => abort.abort();
  }, []);
  const signin = async () => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/auth/signin', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email})});
      setMessage(response.ok ? 'Check your inbox. The sign-in link works once, for 30 minutes.' : 'Could not send the link. Please try again later.');
    } catch { setMessage('Could not reach the server.'); }
    finally { setBusy(false); }
  };
  const remove = async (path: string, keyId?: string) => {
    setBusy(true);
    try {
      const response = await fetch(path, {method:'DELETE'});
      if (!response.ok) throw new Error();
      if (keyId) { setKeys(previous=>previous.filter(key=>key.id!==keyId)); setMessage('API key revoked. Your songs are still yours.'); }
      else { setLibrary(null);setKeys([]);setMessage('Signed out. Your local draft is still here.'); }
    } catch { setMessage('Could not save that change. Please try again.'); }
    finally { setBusy(false); }
  };
  return <details className="account-panel"><summary>Your library &amp; account</summary>{library ? <>
    <p>Signed in as {library.email}. Publications belong to this account.</p>
    <button className="small-button" disabled={busy} onClick={()=>void remove('/api/auth/session')}>Sign out</button>
    <ul>{library.songs.map(song=><li key={song.id}><a href={`/s/${song.id}`}>{song.title || 'Untitled tune'} ↗</a></li>)}</ul>
    {!library.songs.length && <p>Your published tunes will appear here.</p>}
    {keys.some(key=>!key.revoked_at) && <><p>API keys</p><ul>{keys.filter(key=>!key.revoked_at).map(key=><li key={key.id}>{key.label || key.id} <button className="small-button" disabled={busy} onClick={()=>void remove(`/api/keys/${key.id}`,key.id)}>Revoke {key.label || key.id}</button></li>)}</ul></>}
  </> : <form onSubmit={event=>{event.preventDefault();void signin();}}><p>Sign in before publishing to find your tunes again and retain control of them.</p><label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)}/></label><button className="small-button" disabled={busy}>Send sign-in link</button></form>}<p role="status">{message}</p></details>;
}
