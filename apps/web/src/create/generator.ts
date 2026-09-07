import { parseProject, type MusicProject } from "chipvoice";
/** Code runs in a disposable worker inside an opaque-origin, network-denied frame.
 * The account page never evaluates it. The validated result is the playback source. */
export function runGenerator(
  code: string,
  seed: number,
  starter: MusicProject,
): Promise<MusicProject> {
  if (
    code.length > 64000 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff
  )
    return Promise.reject(Error("Invalid generator input"));
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.sandbox.add("allow-scripts");
    const token = crypto.randomUUID();
    const workerSource = `onmessage=({data})=>{try{let seed=data.seed>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};const value=new Function('random','starter',data.code)(random,data.starter);const text=JSON.stringify(value);if(text.length>4000000)throw Error('Generator output is too large');postMessage({text});}catch(error){postMessage({error:String(error.message||error)});}}`;
    const frameSource = `const token=${JSON.stringify(token)};const source=${JSON.stringify(workerSource)};onmessage=event=>{if(event.source!==parent||event.data.token!==token)return;const worker=new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));worker.onmessage=e=>{worker.terminate();parent.postMessage({token,...e.data},'*')};worker.onerror=()=>{worker.terminate();parent.postMessage({token,error:'Generator failed'},'*')};worker.postMessage(event.data);};parent.postMessage({token,ready:true},'*');`;
    frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none'; form-action 'none'"><script>${frameSource.replace(/<\/script/gi, "<\\/script")}<\/script>`;
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      frame.remove();
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.token !== token)
        return;
      if (event.data.ready) {
        frame.contentWindow!.postMessage({ token, code, seed, starter }, "*");
        return;
      }
      cleanup();
      try {
        if (event.data.error) throw Error(String(event.data.error));
        if (
          typeof event.data.text !== "string" ||
          event.data.text.length > 4000000
        )
          throw Error("Invalid generator output");
        const project = parseProject(event.data.text);
        project.generator = { language: "javascript", code, seed };
        resolve(project);
      } catch (error) {
        reject(error);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        Error(
          "Generator exceeded 2 seconds. The previous music is still available.",
        ),
      );
    }, 2000);
    window.addEventListener("message", receive);
    document.body.append(frame);
  });
}
