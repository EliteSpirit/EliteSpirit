// Генератор "созвездия" из реального графика коммитов GitHub.
// Каждый активный день становится звездой (ярче = больше коммитов),
// близкие по времени дни соединяются в созвездия-кластеры, всё мерцает.

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const USERNAME = process.env.GH_USERNAME;

const WIDTH = 900;
const HEIGHT = 420;

async function fetchContributions() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });

  const json = await res.json();
  const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
  const days = [];
  weeks.forEach(w => w.contributionDays.forEach(d => days.push(d)));
  return days;
}

// псевдослучайное число из строки (для стабильного разброса позиций звёзд между запусками)
function seededRandom(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return function () {
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h = (h ^= h >>> 16) >>> 0;
    return h / 4294967296;
  };
}

async function main() {
  const days = await fetchContributions();
  const active = days.filter(d => d.contributionCount > 0);

  const stars = active.map((d, i) => {
    const rand = seededRandom(d.date);
    const x = 30 + rand() * (WIDTH - 60);
    const y = 30 + rand() * (HEIGHT - 60);
    const size = Math.min(4.5, 1.2 + Math.log2(d.contributionCount + 1) * 0.9);
    const delay = (rand() * 4).toFixed(2);
    return { x, y, size, date: d.date, count: d.contributionCount, delay };
  });

  // соединяем звёзды, чьи даты идут подряд (серия коммитов подряд дней) —
  // это и есть созвездие-кластер
  let lines = '';
  for (let i = 1; i < stars.length; i++) {
    const prevDate = new Date(stars[i - 1].date);
    const curDate = new Date(stars[i].date);
    const diffDays = (curDate - prevDate) / 86400000;
    if (diffDays <= 2) {
      lines += `<line x1="${stars[i - 1].x}" y1="${stars[i - 1].y}" x2="${stars[i].x}" y2="${stars[i].y}" stroke="#3fb95040" stroke-width="0.6"/>\n`;
    }
  }

  const starDots = stars.map(s => `
    <circle cx="${s.x.toFixed(1)}" cy="${s.y.toFixed(1)}" r="${s.size.toFixed(2)}" fill="#eafff2" class="star" style="animation-delay:${s.delay}s">
      <title>${s.date} — ${s.count} коммит(ов)</title>
    </circle>`).join('');

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      .bg { fill: #05070a; }
      .star { animation: twinkle 3.5s ease-in-out infinite; transform-origin: center; }
      @keyframes twinkle {
        0%, 100% { opacity: 0.35; }
        50% { opacity: 1; }
      }
    </style>
  </defs>
  <rect class="bg" x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="12"/>
  ${lines}
  ${starDots}
  <text x="20" y="${HEIGHT - 16}" fill="#4a5568" font-family="monospace" font-size="11">${USERNAME} — созвездие из ${active.length} активных дней</text>
</svg>`;

  fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'dist', 'constellation.svg'), svg);
  console.log(`Generated constellation with ${stars.length} stars`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
