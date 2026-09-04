/**
 * The register log: the corpus's file format.
 *
 * A header of `# key: value` lines, then one write per line as
 * `<cycle> <addr hex> <value hex>` in cycle order. It is the smallest thing
 * that holds what every chip is from the outside - bytes to addresses on a
 * clock - and it is readable by a person, diffable by git and parsable by a
 * C program in a dozen lines, which the oracle is.
 *
 * `cycles` in the header is how long to run: writes stop, the chip does not,
 * and a note's tail is as much a test as its start.
 */

const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, '0');

/** @typedef {{ at: number, addr: number, value: number }} Write */

/**
 * @param {{ name: string, chip: string, clock: number, cycles: number, source?: string, notes?: string }} header
 * @param {Write[]} writes
 */
export function formatLog(header, writes) {
  const lines = ['# chipvoice register log v1'];
  for (const [key, value] of Object.entries(header)) {
    if (value !== undefined && value !== null) lines.push(`# ${key}: ${value}`);
  }
  const sorted = [...writes].sort((a, b) => a.at - b.at);
  for (const w of sorted) lines.push(`${w.at} ${hex(w.addr, 4)} ${hex(w.value, 2)}`);
  return lines.join('\n') + '\n';
}

/** @param {string} text */
export function parseLog(text) {
  const header = {};
  const writes = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      const m = /^#\s*([a-z]+):\s*(.*)$/.exec(line);
      if (m) header[m[1]] = m[2];
      continue;
    }
    const [at, addr, value] = line.split(/\s+/);
    writes.push({ at: Number(at), addr: parseInt(addr, 16), value: parseInt(value, 16) });
  }
  return {
    name: header.name ?? '',
    chip: header.chip ?? '',
    clock: Number(header.clock ?? 0),
    cycles: Number(header.cycles ?? 0),
    source: header.source,
    notes: header.notes,
    writes,
  };
}
