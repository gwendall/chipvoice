import {listeningLevels} from './levels.mjs';
const $ = id => document.getElementById(id);
const report = window.REPORT;
const names = {'2a03':'NES',dmg:'Game Boy',md:'Mega Drive',snes:'SNES',c64:'C64'};
const roles = {mix:'Mix complet',lead:'Mélodie',chord:'Accords',bass:'Basse',perc:'Batterie'};
const observations = [];
let context, buffers = [], sources = [], gains = [], entries = [], mapping = [0,1];
let row, level, active = 0, playing = false, hidden = false, generation = 0;
let startedAt = 0, offset = 0, duration = 0;
const option = (value, title) => new Option(title, value);
const number = value => Number.isFinite(value) ? value.toFixed(1) : '—';
for (const item of report.cases) $('case').add(option(item.id, `${item.title} · ${names[item.chip]}`));
$('case').value = report.cases.find(item => item.chip === 'snes')?.id ?? report.cases[0].id;
function stop(reset = false) {
  if (playing) offset = (offset + Math.max(0, context.currentTime - startedAt)) % duration;
  for (const source of sources) { source.stop(); source.disconnect(); }
  for (const gain of gains) gain.disconnect();
  sources = []; gains = []; playing = false;
  if (reset) offset = 0;
  $('play').textContent = 'Écouter';
}
function setSide(side) {
  active = side;
  for (let i = 0; i < gains.length; i++) {
    // A brief fade avoids a switching click; both sources keep the same clock.
    gains[i].gain.setTargetAtTime(i === mapping[active] ? level.gains[i] * Number($('volume').value) : 0, context.currentTime, .005);
  }
  $('a').setAttribute('aria-pressed', String(active === 0));
  $('b').setAttribute('aria-pressed', String(active === 1));
  $('status').textContent = `${playing ? 'Lecture' : 'Prêt'} · ${active ? 'B' : 'A'} · niveaux ${level?.method ?? '—'}`;
}
function identity() {
  $('measurements').hidden = hidden;
  $('reveal').hidden = !hidden;
  $('identity').textContent = hidden ? 'Identités masquées : note ta préférence avant de révéler.' : mapping.slice(0,entries.length).map((index, side) => `${side ? 'B' : 'A'} = ${entries[index].title}`).join(' · ');
}
async function load() {
  const ticket = ++generation;
  stop(true); hidden = false; mapping = [0,1]; active = 0;
  for (const id of ['play','a','b','blind']) $(id).disabled = true;
  $('status').textContent = 'Chargement…';
  const role = $('role').value;
  entries = [{...row.assets[role],title:'Rendu actuel'}];
  if ($('reference').value === 'baseline') entries.push({...row.baseline[role],title:'Version précédente'});
  if ($('reference').value === 'native') entries.push({...row.assets.native,title:'DSP natif snes_spc'});
  level = listeningLevels(entries);
  identity();
  $('metrics').replaceChildren();
  for (const entry of entries) {
    const tr = document.createElement('tr');
    for (const value of [entry.title,number(entry.loudness?.integratedLUFS),number(entry.loudness?.truePeakDbTP),entry.metrics.clippedSamples]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    const td = document.createElement('td'), link = document.createElement('a');
    link.href = entry.file; link.download = entry.file; link.textContent = 'Télécharger'; td.append(link); tr.append(td); $('metrics').append(tr);
  }
  const canvas = $('wave'), draw = canvas.getContext('2d'), envelope = entries[0].metrics.envelope;
  draw.clearRect(0,0,canvas.width,canvas.height); draw.fillStyle = '#b7e18d';
  envelope.forEach((value,index) => draw.fillRect(index*10,60-value*58,7,Math.max(1,value*116)));
  try {
    context ??= new AudioContext();
    const loaded = await Promise.all(entries.map(async entry => {
      const response = await fetch(entry.file); if (!response.ok) throw new Error(`WAV indisponible : ${entry.file}`);
      return context.decodeAudioData(await response.arrayBuffer());
    }));
    if (ticket !== generation) return;
    buffers = loaded; duration = Math.min(...buffers.map(buffer => buffer.duration));
    $('play').disabled = false; $('a').disabled = false;
    $('b').disabled = entries.length < 2; $('blind').disabled = entries.length < 2;
    setSide(0);
  } catch (error) { if (ticket === generation) $('status').textContent = error.message; }
}
function selectReference() {
  const previous = $('reference').value;
  $('reference').replaceChildren(option('none','A seul'));
  if (row.baseline?.[$('role').value]) $('reference').add(option('baseline','Version précédente'));
  if ($('role').value === 'mix' && row.assets.native) $('reference').add(option('native','DSP natif SNES'));
  const available = [...$('reference').options].map(item => item.value);
  $('reference').value = available.includes(previous) ? previous : available.at(-1);
  $('context').textContent = $('reference').value === 'native' ? 'Même partition et mêmes samples. Le DSP natif est à 32 kHz, sans notre étage de sortie : une différence audible ici ne démontre pas un défaut du DSP. Les départs sont communs, sans correction du retard des filtres.' : 'Même partition et même durée entre versions. Écoute synchronisée sur une horloge audio commune ; boucle sur la durée commune.';
  void load();
}
function selectCase() {
  row = report.cases.find(item => item.id === $('case').value);
  const previous = $('role').value;
  $('role').replaceChildren(...Object.keys(row.assets).filter(role => role !== 'native').map(role => option(role,roles[role])));
  if (row.assets[previous] && previous !== 'native') $('role').value = previous;
  $('checks').textContent = `Capture → WAV : ${row.replay.ok ? 'identique' : 'DIVERGENCE'} · Oracle SNES : ${row.oracle ? row.oracle.ok ? 'identique' : 'DIVERGENCE' : 'non évalué'} · ${row.completeLoop ? 'boucle complète' : 'extrait'}`;
  if (row.oracle?.mixer) {
    const mixer = row.oracle.mixer;
    $('checks').textContent += ` · Saturations internes : ${mixer.mainClampedAdditions} (mix), ${mixer.echoClampedAdditions} (entrée écho)`;
  }
  selectReference();
}
$('play').onclick = async () => {
  if (playing) { stop(); setSide(active); return; }
  const ticket = generation;
  await context.resume();
  if (ticket !== generation || playing) return;
  const when = context.currentTime + .025;
  sources = buffers.map((buffer,index) => {
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; source.loop = true; source.loopEnd = duration;
    gain.gain.value = index === mapping[active] ? level.gains[index] * Number($('volume').value) : 0;
    source.connect(gain).connect(context.destination); gains.push(gain); source.start(when,offset); return source;
  });
  startedAt = when; playing = true; $('play').textContent = 'Pause'; setSide(active);
};
$('a').onclick = () => setSide(0); $('b').onclick = () => setSide(1);
$('volume').oninput = () => setSide(active);
$('blind').onclick = () => {
  const bit = crypto.getRandomValues(new Uint8Array(1))[0] & 1;
  mapping = bit ? [1,0] : [0,1]; hidden = true; identity(); setSide(0);
};
$('reveal').onclick = () => { hidden = false; identity(); };
$('case').onchange = selectCase;
$('role').onchange = selectReference;
$('reference').onchange = selectReference;
$('save').onclick = () => {
  observations.push({at:new Date().toISOString(),revision:report.revision,engineSha256:report.engineSha256,case:row.id,role:$('role').value,
    mapping:mapping.slice(0,entries.length).map(index => ({file:entries[index].file,sha256:entries[index].sha256})),
    blind:hidden,level,preference:$('preference').value,notes:$('notes').value});
  $('saved').textContent = `${observations.length} observation(s) dans cet onglet. Exporte-les pour les conserver.`;
  $('notes').value = ''; $('preference').value = 'unsure';
};
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(observations,null,2)],{type:'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'listening-notes.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
};
window.addEventListener('pagehide', () => { stop(true); void context?.close(); });
selectCase();
