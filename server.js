require('dotenv').config();
const { createAppServer } = require('./src/app');
const { createNarrator } = require('./src/narrator');
const { loadConfig } = require('./src/config');

const PORT = Number(process.env.PORT) || 3000;
const config = loadConfig();
const narrator = createNarrator();
const { server } = createAppServer({ narrator, config });

server.listen(PORT, () => {
  console.log(`HGSE Survival running at http://localhost:${PORT}`);
  console.log(`Days last ${config.dayRealMinutes} real minutes; semester is ${config.semesterDays} days.`);
  console.log(narrator.isMock
    ? 'No ANTHROPIC_API_KEY set: events use built-in text (no AI narration).'
    : `AI narrator model: ${narrator.model}`);
});
