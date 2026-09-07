export const pages = {
 create:{path:'/create',title:'Create music · chipvoice',description:'Compose with notes or JavaScript, compare retro consoles and share your music.'},
 explore:{path:'/explore',title:'Explore music · chipvoice',description:'Discover original songs and remixes made with emulated retro sound chips.'},
 library:{path:'/library',title:'Your music library · chipvoice',description:'Manage your profile and music publications.'},
 docs:{path:'/docs',title:'SDK and HTTP API · chipvoice',description:'Create, play, adapt and publish retro music with the chipvoice JavaScript library and HTTP API.'},
 home: {path:'/', title:'chipvoice · Old consoles. New JavaScript.', description:'An open-source sound-chip emulator in JavaScript. Play complete Mario, Zelda and Sonic arrangements on Famicom, Game Boy, Mega Drive and Super Famicom, then make your own music.'},
 about: {path:'/about', title:'About chipvoice · Sound chips, rebuilt in JavaScript', description:'How chipvoice turns text scores into console sound, why hardware constraints matter, and how we check the music.'},
 lab: {path:'/lab', title:'Listening lab · chipvoice', description:'Listen to four classic sound chips. Isolate instruments, compare versions at matched levels and hear the differences for yourself.'},
 components: {path:'/lab/components', title:'Shared components · chipvoice', description:'The shared controls, visual states and accessibility foundations of the chipvoice playground and listening lab.'},
 missing: {path:'', title:'Page not found · chipvoice', description:'This page could not be found. Return to the playground to make some music.'},
} as const;
export type PageId = keyof typeof pages;
