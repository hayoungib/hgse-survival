// Character-creation options. Numbers are first-pass balance values: expect to tune them.

const CONCENTRATIONS = {
  ELOE: {
    id: 'ELOE',
    name: 'Educational Leadership, Organizations, and Entrepreneurship',
    difficulty: 'Medium',
    strengths: 'Networking gains +40%. i-lab events pay off 30% more.',
    weaknesses: 'Opportunity events cost 30% more energy. Studying is 10% less effective.',
    mods: { network: 1.4, mastery: 0.9, opportunityEnergy: 1.3, ilab: 1.3 },
  },
  LDIT: {
    id: 'LDIT',
    name: 'Learning Design, Innovation, and Technology',
    difficulty: 'Hard',
    strengths: 'Studying +20% with a working laptop. GSD alliance grows 30% faster. i-lab +30%.',
    weaknesses: 'A dead laptop cuts your study AND class gains to 30%.',
    mods: { mastery: 1.2, gsd: 1.3, laptopBroken: 0.3, ilab: 1.3 },
  },
  EPA: {
    id: 'EPA',
    name: 'Education Policy and Analysis',
    difficulty: 'Medium',
    strengths: 'HKS alliance grows 50% faster. Networking +10%.',
    weaknesses: 'Strikes cost you 15 energy: you get pulled into the policy debate.',
    mods: { hks: 1.5, network: 1.1, strikeEnergy: 15 },
  },
  HDE: {
    id: 'HDE',
    name: 'Human Development and Education',
    difficulty: 'Easy',
    strengths: '+10 overnight energy recovery. Social events restore energy instead of draining it.',
    weaknesses: 'Networking 10% weaker. MIT encounters hit 50% harder.',
    mods: { recovery: 10, socialRestores: true, network: 0.9, mitDamage: 1.5 },
  },
  TTF: {
    id: 'TTF',
    name: 'TTF', // TODO: replace with the full program name
    difficulty: 'Hard',
    strengths: 'Class attendance +30%. +10 on every presentation.',
    weaknesses: 'Classes cost 20% more energy. You start with $100 less.',
    mods: { classMastery: 1.3, presentation: 10, classEnergy: 1.2, startMoney: -100 },
  },
};

// Location ids match src/data/map.js
const HOUSING = {
  kronkite: {
    id: 'kronkite', name: 'Kronkite',
    blurb: '2 minutes from Gutman, Longfellow and Larsen. Most expensive.',
    rent: 40, recovery: 55,
  },
  peabody: {
    id: 'peabody', name: 'Peabody Terrace',
    blurb: 'By the Charles River, ~25 minute walk. Quietest: best sleep. River walks restore +5 extra.',
    rent: 28, recovery: 65, riverBonus: 5,
  },
  southCampus: {
    id: 'southCampus', name: '100 South Campus Drive',
    blurb: 'Next to Harvard Stadium, close to the i-lab. i-lab events +20%.',
    rent: 32, recovery: 58, ilab: 1.2,
  },
  somerville: {
    id: 'somerville', name: 'Harvard Housing in Somerville',
    blurb: 'Next to the Divinity School and Law School. Cheapest, but HLS students are your neighbors.',
    rent: 22, recovery: 55, hlsNeighbors: true,
  },
};

// Fictional course catalog. Tags connect courses to dream jobs.
const COURSES = {
  leadingChange: { id: 'leadingChange', name: 'Leading Organizational Change', tags: ['leadership'] },
  edEntrepreneurship: { id: 'edEntrepreneurship', name: 'Education Entrepreneurship', tags: ['entrepreneurship'] },
  learningDesign: { id: 'learningDesign', name: 'Designing for Learning', tags: ['design', 'technology'] },
  edTechLab: { id: 'edTechLab', name: 'Ed Tech Prototyping Lab', tags: ['technology', 'entrepreneurship'] },
  policyAnalysis: { id: 'policyAnalysis', name: 'Education Policy Analysis', tags: ['policy', 'data'] },
  quantMethods: { id: 'quantMethods', name: 'Quantitative Methods', tags: ['data', 'research'] },
  childDev: { id: 'childDev', name: 'Child and Adolescent Development', tags: ['development'] },
  qualResearch: { id: 'qualResearch', name: 'Qualitative Research Methods', tags: ['research', 'development'] },
  teachingPracticum: { id: 'teachingPracticum', name: 'Teaching Practicum', tags: ['teaching'] },
  instrLeadership: { id: 'instrLeadership', name: 'Instructional Leadership', tags: ['leadership', 'teaching'] },
};
const COURSES_REQUIRED = 4;

const DREAM_JOBS = {
  edtechFounder: { id: 'edtechFounder', name: 'Ed-tech startup founder', tags: ['entrepreneurship', 'technology'], ally: 'gsd' },
  policyAdvisor: { id: 'policyAdvisor', name: 'Education policy advisor', tags: ['policy', 'data'], ally: 'hks' },
  schoolLeader: { id: 'schoolLeader', name: 'School leader', tags: ['leadership', 'teaching'], ally: 'hks' },
  learningDesigner: { id: 'learningDesigner', name: 'Learning experience designer', tags: ['design', 'technology'], ally: 'gsd' },
  researcher: { id: 'researcher', name: 'Child development researcher', tags: ['development', 'research'], ally: 'hks' },
};

const MAX_NAME_LENGTH = 20;
function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

/** Validates a join request. Returns { ok, setup } or { ok:false, error }. */
function validateSetup(payload) {
  const p = payload || {};
  const name = cleanName(p.name);
  if (!name) return { ok: false, error: 'Please enter a name.' };
  if (!CONCENTRATIONS[p.concentration]) return { ok: false, error: 'Pick a concentration.' };
  if (!HOUSING[p.housing]) return { ok: false, error: 'Pick your housing.' };
  if (!DREAM_JOBS[p.dreamJob]) return { ok: false, error: 'Pick a dream job.' };
  const courses = Array.isArray(p.courses) ? [...new Set(p.courses)] : [];
  if (courses.length !== COURSES_REQUIRED || !courses.every((c) => COURSES[c])) {
    return { ok: false, error: `Pick exactly ${COURSES_REQUIRED} courses.` };
  }
  return {
    ok: true,
    setup: { name, concentration: p.concentration, housing: p.housing, dreamJob: p.dreamJob, courses },
  };
}

function publicCatalog(config) {
  return {
    concentrations: Object.values(CONCENTRATIONS).map(({ mods, ...rest }) => rest),
    housing: Object.values(HOUSING).map(({ id, name, blurb, rent }) => ({ id, name, blurb, rent })),
    courses: Object.values(COURSES),
    coursesRequired: COURSES_REQUIRED,
    dreamJobs: Object.values(DREAM_JOBS),
    rules: {
      semesterDays: config.semesterDays,
      dayRealMinutes: config.dayRealMinutes,
      maxBurnouts: config.maxBurnouts,
      maxPlayers: config.maxPlayers,
    },
  };
}

module.exports = {
  CONCENTRATIONS, HOUSING, COURSES, COURSES_REQUIRED, DREAM_JOBS,
  cleanName, validateSetup, publicCatalog,
};
