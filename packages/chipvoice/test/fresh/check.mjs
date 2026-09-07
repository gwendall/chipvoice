import { chromium } from 'playwright';

/**
 * What `npm install chipvoice` gives somebody, measured.
 *
 * Everything else in this repo tests the source. This installs the published
 * tarball into an empty project and drives it the way a first user would - it
 * is the only check that can catch a broken `files` list, a missing export, or
 * a worklet that did not make it into the package.
 *
 * Run from a directory where `npm i chipvoice` has been done, serving it on
 * FRESH_URL.
 */
const URL_ = process.env.FRESH_URL || 'http://localhost:4180/';
const guard = setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 90000);
guard.unref();

let failures = 0;
const check = (n, ok, extra = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.click('#go');
  const started = await page
    .waitForFunction(() => window.ready, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check('the installed package starts a chip', started);
  if (!started) throw new Error('nothing below would mean anything');

  /*
   * One evaluate for the whole measurement, analyser included.
   *
   * The first version built the analyser in one call and sampled in another,
   * and read a flat zero against a package that was playing perfectly - which
   * is worse than no test, because it accuses the thing under test.
   */
  const heard = await page.evaluate(async () => {
    const chip = window.chip;
    const analyser = chip.audioContext.createAnalyser();
    analyser.fftSize = 2048;
    chip.output.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const peaks = [];
    const positions = new Set();
    // Two seconds of audio time, not of wall time. A cold headless Chromium
    // brings its audio thread up slowly, and two seconds on the wall clock can
    // be a tenth of a second of audio - which reads as a sequencer that never
    // moved, and failed a release for a reason that had nothing to do with it.
    const t0 = chip.currentTime;
    const deadline = Date.now() + 15000;
    while (chip.currentTime - t0 < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let j = 0; j < buf.length; j++) peak = Math.max(peak, Math.abs(buf[j]));
      peaks.push(peak);
      const pos = chip.position();
      if (pos) positions.add(pos.step);
    }
    return {
      peak: Math.round(Math.max(...peaks) * 100) / 100,
      steps: positions.size,
      songId: chip.songId,
      playing: chip.playing,
      audioSeconds: Math.round((chip.currentTime - t0) * 10) / 10,
    };
  });

  check('and it makes a sound', heard.peak > 0.05, `peak ${heard.peak}`);
  check('the sequencer runs', heard.playing && heard.songId === 'smoke', JSON.stringify(heard));
  check('and reports a moving position', heard.steps > 3, `${heard.steps} distinct steps`);

  const steal = await page.evaluate(async () => {
    const chip = window.chip;
    const at = chip.currentTime;
    chip.sfx('p2', {
      note: 'B6',
      instrument: { duty: 0, volume: [13, 10, 6, 2], slide: -3.4 },
      duration: 0.2,
    });
    return { during: chip.canPlay('p2', at + 0.05), after: chip.canPlay('p2', at + 0.4) };
  });
  check(
    'an effect takes the channel from the music',
    steal.during === false && steal.after === true,
    JSON.stringify(steal),
  );

  const projects = await page.evaluate(async () => {
    window.chip.stop();
    const {ProjectPlayer, projectFromScore, projectFromPerformance, prepareProject} = await import('./node_modules/chipvoice/dist/index.js');
    const score=projectFromScore({bpm:120,patterns:[{lead:'C4 . E4 . G4 . E4 .',bass:'. . . . . . . .',chord:'. . . . . . . .',perc:'. . . . . . . .',chordShape:[[0,4,7]]}],order:[0]},{title:'Fresh score'});
    const context=new AudioContext(),player=new ProjectPlayer({context});
    const legacy=await player.load(score);await player.play();
    const performance=projectFromPerformance({version:1,title:'Fresh performance',ticksPerBeat:480,endTick:960,tempos:[{tick:0,microsecondsPerBeat:500000}],parts:[{id:'lead',name:'Lead',role:'lead',priority:1,notes:[{id:'one',tick:0,endTick:900,pitch:64,velocity:90,program:80}]}],notices:[]});
    const complete=await player.load(performance);
    const replaced=await player.update({chip:'md'});
    const obsolete=player.update({chip:'snes'}),latest=player.update({chip:'dmg'});
    const outcomes=await Promise.all([obsolete,latest]);
    const failed=await player.load({...performance,settings:{chip:'invalid'}});
    const preserved=player.playing && typeof player.prepared.engineVersion==='string';
    const abort=new AbortController();abort.abort();
    const realResume=context.resume.bind(context);let resumed;
    context.resume=()=>new Promise(resolve=>{resumed=resolve;});
    player.pause();const pendingPlay=player.play();player.pause();resumed();await pendingPlay;
    const pauseWins=!player.playing;context.resume=realResume;await player.play();
    const cancelled=await prepareProject(performance,{signal:abort.signal}).then(()=>false,e=>e.name==='AbortError');
    player.seek(.4); await new Promise(r=>setTimeout(r,150));
    const seek=player.position>.3 && player.position<.8;
    const analyser=context.createAnalyser();player.output.connect(analyser);const samples=new Float32Array(analyser.fftSize);
    await new Promise(r=>setTimeout(r,120));analyser.getFloatTimeDomainData(samples);const peak=Math.max(...samples.map(Math.abs));
    player.dispose();const callerOwned=context.state!=='closed';await context.close();
    const owned=new ProjectPlayer();owned.dispose();await new Promise(r=>setTimeout(r,20));
    return {legacy,complete,replaced,outcomes,failed,preserved,cancelled,seek,peak,callerOwned,pauseWins,ownClosed:owned.context.state==='closed'};
  });
  check('installed project facade preserves playback, aborts superseded work and owns only its context', projects.legacy && projects.complete && projects.replaced && projects.outcomes[0]===false && projects.outcomes[1]===true && projects.failed===false && projects.preserved && projects.cancelled && projects.seek && projects.peak>.001 && projects.callerOwned && projects.pauseWins && projects.ownClosed, JSON.stringify(projects));

  check('no errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
