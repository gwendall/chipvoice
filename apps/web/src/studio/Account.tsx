'use client';
import {SignInForm} from '@/auth/SignInForm';
import {useSession} from '@/auth/useSession';
import {useI18n, useT} from '@/i18n/react';
import {localePath} from '@/i18n/core';
import { useEffect, useState } from 'react';
type Library = {email:string;songs:{id:string;title:string|null}[]};
type Key = {id:string;label:string|null;revoked_at:number|null};

/** Account tools stay inside sharing; playing and saving drafts need no login. */
export function Account() {
 const t = useT();
 const {locale} = useI18n();
  const [library,setLibrary] = useState<Library|null>(null);
  const [keys,setKeys] = useState<Key[]>([]);
  const session = useSession();
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
        } else if (response.status === 401) { setLibrary(null); setKeys([]); } else setMessage('Accounts are unavailable right now. Your local draft is safe.');
      } catch { if (!abort.signal.aborted) setMessage('Could not reach your library.'); }
      finally { if (!abort.signal.aborted) setBusy(false); }
    })();
    return () => abort.abort();
  }, [session.status, session.email]);
  const remove = async (path: string, keyId?: string) => {
    setBusy(true);
    try {
      const response = await fetch(path, {method:'DELETE'});
      if (!response.ok) throw new Error();
      if (keyId) { setKeys(previous=>previous.filter(key=>key.id!==keyId)); setMessage('API key revoked. Your songs are still yours.'); }
      else { setLibrary(null);setKeys([]);setMessage('Signed out. Your local draft is still here.');window.dispatchEvent(new Event('chipvoice-session')); }
    } catch { setMessage('Could not save that change. Please try again.'); }
    finally { setBusy(false); }
  };
  return <details className="account-panel"><summary>{t("Your library & account")}</summary>{library ? <>
    <p>{t("Signed in as ")}{library.email}{t(". Publications belong to this account.")}</p>
    <button className="small-button" disabled={busy} onClick={()=>void remove('/api/auth/session')}>{t("Sign out")}</button>
    <ul>{library.songs.map(song=><li key={song.id}><a href={localePath(`/s/${song.id}`,locale)}>{song.title || t('Untitled tune')} ↗</a></li>)}</ul>
    {!library.songs.length && <p>{t("Your published tunes will appear here.")}</p>}
    {keys.some(key=>!key.revoked_at) && <><p>{t("API keys")}</p><ul>{keys.filter(key=>!key.revoked_at).map(key=><li key={key.id}>{key.label || key.id} <button className="small-button" disabled={busy} onClick={()=>void remove(`/api/keys/${key.id}`,key.id)}>{t("Revoke ")}{key.label || key.id}</button></li>)}</ul></>}
  </> : <SignInForm/>}<p role="status">{t(message)}</p></details>;
}
