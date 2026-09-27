export const pages = {
  signin: { path: "/signin", title: "Sign in · chipvoice", description: "Sign in with your email to save, generate and publish your music." },
  signinConfirm: {
    path: "/signin/confirm",
    title: "Confirm sign-in · chipvoice",
    description: "Finish signing in to chipvoice with one click.",
  },
  connect: {
    path: "/connect",
    title: "Connect an agent · chipvoice",
    description:
      "Authorize an agent to compose and publish music for your artist, with limited and revocable access.",
  },
  create: {
    path: "/create",
    title: "Create music · chipvoice",
    description:
      "Compose with notes or JavaScript, compare retro consoles and share your music.",
  },
  explore: {
    path: "/explore",
    title: "Explore music · chipvoice",
    description:
      "Discover original songs and remixes made with emulated retro sound chips.",
  },
  library: {
    path: "/library",
    title: "Your music library · chipvoice",
    description: "Manage your profile and music publications.",
  },
  docs: {
    path: "/docs",
    title: "SDK and HTTP API · chipvoice",
    description:
      "Create, play, adapt and publish retro music with the chipvoice JavaScript library and HTTP API.",
  },
  home: {
    path: "/",
    title: "chipvoice · Old consoles. New JavaScript.",
    description:
      "An open-source sound-chip emulator in JavaScript. Play complete Mario, Zelda and Sonic arrangements on Famicom, Game Boy, Mega Drive and Super Famicom, then make your own music.",
  },
  about: {
    path: "/about",
    title: "About chipvoice · Sound chips, rebuilt in JavaScript",
    description:
      "How chipvoice turns text scores into console sound, why hardware constraints matter, and how we check the music.",
  },
  accuracy: {
    path: "/accuracy",
    title: "Accuracy · chipvoice",
    description:
      "Digital parity, test ROMs, the analog stage and driver coverage for every emulated sound chip, generated from the conformance harness.",
  },
  instruments: {
    path: "/instruments",
    title: "Instrument catalogue · chipvoice",
    description:
      "Every preset a chip can play, with its measured envelope, spectrum and a short preview, built only from what the chip really does.",
  },
  lab: {
    path: "/lab",
    title: "Listening lab · chipvoice",
    description:
      "Listen to four classic sound chips. Isolate instruments, compare versions at matched levels and hear the differences for yourself.",
  },
  components: {
    path: "/lab/components",
    title: "Shared components · chipvoice",
    description:
      "The shared controls, visual states and accessibility foundations of the chipvoice playground and listening lab.",
  },
  renderParity: {
    path: "/lab/render-parity",
    title: "Render parity checker · chipvoice",
    description:
      "Renders a fixed set of inputs in this browser and compares the result byte for byte against Node, on the device you opened it on.",
  },
  missing: {
    path: "",
    title: "Page not found · chipvoice",
    description:
      "This page could not be found. Return to the playground to make some music.",
  },
} as const;
export type PageId = keyof typeof pages;
