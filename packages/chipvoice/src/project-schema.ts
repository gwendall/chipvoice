/** JSON Schema is the shared SDK, HTTP and documentation contract. */
export interface DataSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, DataSchema>;
  required?: string[];
  additionalProperties?: boolean | DataSchema;
  items?: DataSchema;
  enum?: readonly (string | number | boolean)[];
  oneOf?: DataSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}
const num = (
  minimum: number,
  maximum: number,
  integer = false,
): DataSchema => ({ type: integer ? "integer" : "number", minimum, maximum });
const str = (maxLength = 120, minLength = 0): DataSchema => ({
  type: "string",
  minLength,
  maxLength,
});
const arr = (
  items: DataSchema,
  maxItems: number,
  minItems = 0,
): DataSchema => ({ type: "array", items, minItems, maxItems });
const obj = (
  properties: Record<string, DataSchema>,
  required = Object.keys(properties),
): DataSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const choice = (...values: string[]): DataSchema => ({
  type: "string",
  enum: values,
});
const optional = (schema: DataSchema, required: string[] = []): DataSchema => ({
  ...schema,
  required,
});
const dictionary = (schema: DataSchema): DataSchema => ({
  type: "object",
  additionalProperties: schema,
});
const bool: DataSchema = { type: "boolean" };
const tick = num(0, Number.MAX_SAFE_INTEGER, true);
export const CHIP_IDS = ["2a03", "dmg", "md", "snes", "c64"] as const;
export type ProjectChip = (typeof CHIP_IDS)[number];
const chip = choice(...CHIP_IDS);
const waveform = choice("pulse", "triangle", "sawtooth", "noise");
const operator = obj(
  {
    dt: num(0, 7, true),
    mul: num(0, 15, true),
    tl: num(0, 127, true),
    ks: num(0, 3, true),
    ar: num(0, 31, true),
    dr: num(0, 31, true),
    sr: num(0, 31, true),
    sl: num(0, 15, true),
    rr: num(0, 15, true),
    am: bool,
  },
  ["dt", "mul", "tl", "ks", "ar", "dr", "sr", "sl", "rr"],
);
const instrument = obj(
  {
    volume: arr(num(0, 15), 4096, 1),
    duty: { oneOf: [num(0, 3, true), arr(num(0, 3, true), 4096, 1)] },
    arp: arr(num(-127, 127), 4096),
    pitch: arr(num(-65535, 65535), 4096),
    slide: num(-96, 96),
    sustain: bool,
    arpLoop: bool,
    noiseMode: bool,
    vibrato: obj(
      { depth: num(0, 96), rate: num(0.001, 100000), delay: num(0, 100000) },
      ["depth", "rate"],
    ),
    waveform: { oneOf: [waveform, arr(waveform, 4096, 1)] },
    wave: arr(num(0, 15, true), 32, 32),
    fm: obj(
      {
        algorithm: num(0, 7, true),
        feedback: num(0, 7, true),
        ops: arr(operator, 4, 4),
        ams: num(0, 3, true),
        pms: num(0, 7, true),
      },
      ["algorithm", "feedback", "ops"],
    ),
    sample: str(80, 1),
  },
  ["volume"],
);
const pattern = obj({
  bass: str(4096),
  lead: str(4096),
  chord: str(4096),
  perc: str(4096),
  chordShape: arr(arr(num(-127, 127, true), 32, 1), 256, 1),
});
export const SCORE_DATA_SCHEMA = obj(
  {
    id: str(120),
    bpm: num(40, 300),
    stepsPerBeat: { enum: [4, 12] },
    patterns: arr(pattern, 64, 1),
    order: arr(num(0, 63, true), 256, 1),
    gain: num(0, 1),
    chip,
    intent: optional(
      obj({
        lead: choice("soft", "bright", "round"),
        chord: choice("plucked", "held"),
        bass: choice("round", "hollow", "bright"),
        perc: choice("tight", "soft"),
      }),
    ),
  },
  ["bpm", "patterns", "order"],
);
const note = obj(
  {
    id: str(120, 1),
    tick,
    endTick: tick,
    pitch: num(0, 127),
    velocity: num(1, 127, true),
    program: num(0, 127, true),
    drum: num(0, 127, true),
    expression: arr(
      obj(
        {
          tick,
          pitch: num(-96, 96),
          gain: num(0, 1),
          duty: num(0, 3, true),
          noisePeriod: num(0, 15, true),
        },
        ["tick"],
      ),
      200000,
    ),
  },
  ["id", "tick", "endTick", "pitch", "velocity"],
);
const timbre = obj({
  sourceSignature: str(8192, 1),
  pitchOffset: num(-48, 48),
  program: num(0, 127, true),
  envelope: arr(num(0, 1), 120, 1),
  rms: num(0, 100),
  confidence: num(0, 1),
});
export const PERFORMANCE_DATA_SCHEMA = obj(
  {
    version: { enum: [1] },
    title: str(240),
    ticksPerBeat: num(1, Number.MAX_SAFE_INTEGER, true),
    endTick: tick,
    loopStartTick: tick,
    tempos: arr(
      obj({ tick, microsecondsPerBeat: num(1, 0xffffff, true) }),
      100000,
      1,
    ),
    parts: arr(
      obj(
        {
          id: str(120, 1),
          name: str(240),
          role: choice("lead", "chord", "bass", "perc"),
          priority: num(-100000, 100000),
          program: num(0,127,true),
          muted: bool,
          notes: arr(note, 100000),
          origin: obj({ chip: str(64), voice: str(64) }),
          mix: optional(obj({ gainDb: num(-96, 12), importance: num(0, 1) })),
          roleInference: obj({
            confidence: choice("high", "medium", "low"),
            reason: choice(
              "channel",
              "name",
              "program",
              "polyphony",
              "register",
              "monophony",
              "override",
            ),
          }),
          instruments: dictionary(instrument),
          portableTimbres: dictionary(timbre),
        },
        ["id", "name", "role", "priority", "notes"],
      ),
      256,
    ),
    source: obj(
      {
        kind: choice("midi", "native"),
        name: str(240),
        sha256: str(64),
        url: str(2048),
        description: str(4096),
      },
      ["kind", "name"],
    ),
    notices: arr(str(4096), 1024),
    midi: obj({
      format: num(0, 1, true),
      events: arr(
        obj({
          tick,
          track: num(0, 65535, true),
          order: tick,
          status: num(0, 255, true),
          data: arr(num(0, 255, true), 65536),
        }),
        200000,
      ),
    }),
  },
  ["version", "title", "ticksPerBeat", "endTick", "tempos", "parts", "notices"],
);
const loss = obj(
  { part: str(120), note: str(120), kind: str(120), detail: str(4096) },
  ["part", "kind", "detail"],
);
export const PLAN_DATA_SCHEMA = obj(
  {
    chip,
    musicStartCycle: tick,
    seconds: num(0.000001, 600),
    loopStartSeconds: num(0, 600),
    events: arr(
      obj({ at: tick, addr: num(0, 0xffffff, true), value: num(0, 255, true) }),
      2000000,
    ),
    memory: arr(
      obj({
        address: num(0, 0xffffff, true),
        bytes: arr(num(0, 255, true), 8388608),
      }),
      256,
    ),
    notes: arr(
      obj({
        part: str(120),
        id: str(120),
        voice: str(120),
        pitch: num(0, 127),
        at: num(0, 600),
        until: num(0, 600),
      }),
      100000,
    ),
    losses: arr(loss, 200000),
    silentNotes: arr(obj({ part: str(120), id: str(120) }), 100000),
    mix: obj({
      version: { enum: [1] },
      calibratedNotes: tick,
      fallbackNotes: tick,
      diagnostics: arr(
        obj({ part: str(120), kind: str(120), detail: str(4096) }),
        200000,
      ),
    }),
  },
  [
    "chip",
    "seconds",
    "loopStartSeconds",
    "events",
    "memory",
    "notes",
    "losses",
  ],
);
export const PROJECT_SCHEMA: DataSchema = obj(
  {
    version: { enum: [1] },
    title: str(80, 1),
    description: str(2000),
    author: str(80),
    licence: { enum: ["reserved", "CC0-1.0", "CC-BY-4.0"] },
    tags: arr(str(24, 1), 8),
    source: {
      oneOf: [
        obj({ kind: choice("score"), score: SCORE_DATA_SCHEMA }),
        obj({
          kind: choice("performance"),
          performance: PERFORMANCE_DATA_SCHEMA,
        }),
        obj({
          kind: choice("native"),
          plan: PLAN_DATA_SCHEMA,
          performance: PERFORMANCE_DATA_SCHEMA,
        }),
      ],
    },
    settings: obj(
      {
        chip,
        tempoScale: num(0.1, 10),
        transpose: num(-48, 48),
        gain: num(0, 1),
        mix: choice("auto", "authored"),
        allowLoss: bool,
      },
      ["chip"],
    ),
    generator: obj({
      language: choice("javascript"),
      code: str(64000, 1),
      seed: num(0, 0xffffffff, true),
    }),
  },
  ["version", "title", "source", "settings"],
);
export interface ProjectIssue {
  path: string;
  code: string;
  message: string;
  level: "error" | "warning";
}
/** Never strip unknown keys. Failures retain paths for editors and HTTP clients. */
export function checkData(
  value: unknown,
  schema: DataSchema,
  path = "$",
  issues: ProjectIssue[] = [],
  budget = { remaining: 2000000 },
): ProjectIssue[] {
  if (issues.length >= 32) return issues;
  const fail = (message: string, code = "invalid_value") => {
    issues.push({ path, code, message, level: "error" });
  };
  if (--budget.remaining < 0) {
    fail("Document exceeds validation work limit", "limit");
    return issues;
  }
  if (schema.oneOf) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "kind" in value
    ) {
      const branch = schema.oneOf.find((branch) =>
        branch.properties?.kind?.enum?.includes(
          (value as { kind: string }).kind,
        ),
      );
      if (branch) return checkData(value, branch, path, issues, budget);
    }
    for (const branch of schema.oneOf) {
      const candidate = checkData(value, branch, path, [], budget);
      if (!candidate.length) return issues;
    }
    fail(
      "Value does not match a supported source or value shape",
      "invalid_variant",
    );
    return issues;
  }
  if (schema.enum && !schema.enum.includes(value as string)) {
    fail("Unsupported value", "unsupported");
    return issues;
  }
  if (schema.type === "object") {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    ) {
      fail("Expected a plain object");
      return issues;
    }
    const data = value as Record<string, unknown>;
    if (Object.keys(data).length > 4096) {
      fail("Too many object keys", "limit");
      return issues;
    }
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(data, key)) {
        issues.push({
          path: `${path}.${key}`,
          code: "required",
          message: "Required field",
          level: "error",
        });
      }
    for (const [key, item] of Object.entries(data)) {
      if (
        item === undefined &&
        Object.hasOwn(schema.properties ?? {}, key) &&
        !(schema.required ?? []).includes(key)
      )
        continue;
      const child = Object.hasOwn(schema.properties ?? {}, key)
        ? schema.properties![key]
        : schema.additionalProperties;
      if (
        key === "__proto__" ||
        key === "constructor" ||
        key === "prototype" ||
        child === false ||
        child === undefined
      ) {
        issues.push({
          path: `${path}.${key}`,
          code: "unknown_field",
          message: "Unknown field",
          level: "error",
        });
      } else if (typeof child === "object")
        checkData(item, child, `${path}.${key}`, issues, budget);
      if (issues.length >= 32) break;
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) {
      fail("Expected an array");
      return issues;
    }
    if (
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? 100000)
    ) {
      fail("Array length outside supported bounds", "limit");
      return issues;
    }
    for (let i = 0; i < value.length && issues.length < 32; i++)
      checkData(value[i], schema.items!, `${path}[${i}]`, issues, budget);
  } else if (schema.type === "string") {
    if (typeof value !== "string") fail("Expected text");
    else if (
      value.length < (schema.minLength ?? 0) ||
      value.length > (schema.maxLength ?? 4096)
    )
      fail("Text length outside supported bounds", "limit");
  } else if (schema.type === "number" || schema.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (schema.type === "integer" && !Number.isSafeInteger(value)) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity)
    )
      fail("Number outside supported bounds");
  } else if (schema.type === "boolean" && typeof value !== "boolean")
    fail("Expected a boolean");
  return issues;
}
