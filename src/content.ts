/**
 * Everything a visitor reads, every link and the portrait live here.
 * Edit this file and rebuild (`npm run build`). The rendered film and the
 * helmet poses never contain text, so nothing needs re-rendering.
 *
 * Fields marked PLACEHOLDER are shown on the page with a visible
 * "placeholder" tag until you replace them. Nothing here is invented:
 * empty fields stay empty rather than being filled with made-up details.
 */

export interface Project {
  /** Shown as a card. `draft: true` adds a "Draft" tag until you confirm the entry. */
  title: string;
  description: string;
  problem: string;
  role: string; // leave '' to show "Add your role"
  tech: string[];
  image?: string; // path under public/, e.g. 'assets/projects/name.webp'
  imageAlt?: string;
  url?: string;
  linkLabel?: string;
  draft?: boolean;
}

export interface ContactLink {
  label: string;
  href: string;
}

/**
 * Portrait alignment from the tool at /align.html: pixel positions in the
 * photo of the centre of each eye and the bottom of the chin. "Right eye"
 * is the person's right eye, which is on the left of the photo.
 */
export interface Portrait {
  src: string;
  eyeR: [number, number];
  eyeL: [number, number];
  chin: [number, number];
  /** Optional nudges, applied after alignment (1 = no change). */
  exposure?: number;
  warmth?: number;
  /**
   * Optional: glasses redrawn as a red laser frame. `src` is the outline
   * traced from the photo by pipeline/portrait/prep-portrait.py (photo pixels).
   */
  eyewear?: { src: string; color?: string } | null;
}

export const content = {
  /** PLACEHOLDER: your name or alias. Used in the header, the reveal, the footer and the page title. */
  name: 'Your Name',
  role: 'Creative Technologist',
  /** PLACEHOLDER: the address the site will live at (used for the canonical link and sharing previews). */
  siteUrl: 'https://example.com/',

  hero: {
    headline: 'I turn ideas into reality.',
    support:
      'I build digital experiences, intelligent systems, and creative technology that turn ambitious ideas into something real.',
    primary: { label: 'Explore my work', href: '#work' },
    secondary: { label: 'Meet the mind', href: '#armor' },
  },

  reveal: {
    quote: 'The armor is the technology. The mind behind it is human.',
    /** PLACEHOLDER: two or three sentences in your own words. */
    intro:
      'A short introduction goes here: who you are, what you make, and the kind of problems you like to be handed. Two or three sentences is plenty.',
    introIsPlaceholder: true,
    cta: { label: 'Explore my work', href: '#work' },
  },

  about: {
    heading: 'The person behind the armor',
    /** PLACEHOLDER paragraphs. */
    paragraphs: [
      'This is where you say who you are and how you work. Say what you build, who you build it for, and what you care about when you build it.',
      'Keep it specific: the tools you reach for, the size of team you like, the moment in a project you enjoy most.',
    ],
    paragraphsArePlaceholder: true,
    /** PLACEHOLDER facts. Remove any you do not want to show. */
    facts: [
      { label: 'Based in', value: '' },
      { label: 'Working with', value: '' },
      { label: 'Currently', value: '' },
    ] as { label: string; value: string }[],
  },

  /** The areas from the brief. Keep the ones you actually offer; reword freely. */
  capabilities: [
    {
      title: 'Creative development',
      text: 'Interactive sites and experiences where motion, 3D and storytelling carry the message.',
    },
    {
      title: 'AI-powered systems',
      text: 'Tools and products that put language and vision models to practical use.',
    },
    {
      title: 'Web experiences',
      text: 'Fast, accessible front ends that hold up on a phone as well as on a large screen.',
    },
    {
      title: 'Digital product development',
      text: 'Taking an idea from first prototype to something people can use every day.',
    },
    {
      title: 'Automation and experiments',
      text: 'Scripts, pipelines and prototypes that remove busywork or test an idea quickly.',
    },
  ],
  capabilitiesNote: 'Check that each of these matches what you offer before publishing.',

  projects: [
    {
      title: 'Gyre',
      description:
        'A concept product site for a fictional spinning top: a scroll-driven 3D story, a working spin simulation and a variant configurator.',
      problem: 'Make one small object carry a long, interactive product story without slowing the page down.',
      role: '',
      tech: ['TypeScript', 'React', 'Three.js', 'GSAP'],
      image: 'assets/projects/gyre.webp',
      imageAlt: 'A walnut and brass spinning top on a dark background beside the word Gyre.',
      url: 'https://github.com/chanceryuzu-hue/gyre',
      linkLabel: 'View the repository',
      draft: true,
    },
  ] as Project[],
  /** Empty case-study slots shown after the projects above. Set to 0 to hide them. */
  projectSlots: 2,

  process: [
    { title: 'Discover', text: 'Understand the goal, the audience and what success looks like.' },
    { title: 'Design', text: 'Shape the idea into flows, visuals and a plan that can be built.' },
    { title: 'Build', text: 'Make it real, in small working steps you can see and try.' },
    { title: 'Test', text: 'Check it on real devices, with real content, against the goal.' },
    { title: 'Improve', text: 'Measure what happens after launch and refine what matters.' },
  ],

  contact: {
    heading: 'Have a mission in mind?',
    support: "Let's build something extraordinary.",
    /** PLACEHOLDER: your email address. Empty = the button says it has not been added yet. */
    email: '',
    /** Optional, international format, e.g. '+44 20 7946 0000'. Empty = hidden. */
    phone: '',
    links: [{ label: 'GitHub', href: 'https://github.com/chanceryuzu-hue' }] as ContactLink[],
  },

  /**
   * Your face behind the visor: the photo, cropped by pipeline/portrait/prep-portrait.py,
   * with its eye and chin positions (from /align.html or the prep script). Its glasses
   * are redrawn as a red laser frame; set `eyewear: null` for a photo without glasses.
   * null = the sculpted placeholder head.
   */
  portrait: {
    src: 'assets/portrait/my-face.webp',
    eyeR: [276, 342],
    eyeL: [621.5, 339],
    chin: [450, 921],
    exposure: 1,
    warmth: 1,
    eyewear: { src: 'assets/portrait/eyewear.json', color: '#ff2a36' },
  } as Portrait | null,
};

export type Content = typeof content;
