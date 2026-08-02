// Генератор "ночного города" из реального графика коммитов GitHub.
// Каждый активный день — здание: высота = число коммитов, окна светятся
// пропорционально активности, цвет от холодного синего (старые дни)
// к тёплому оранжевому (свежие). Окна мягко "дышат" вразнобой.

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN;
const USERNAME = process.env.GH_USERNAME;

const WIDTH = 900;
const HEIGHT = 420;

const GROUND_Y = HEIGHT - 46;      // линия земли
const MIN_BUILDING_H = 26;
const MAX_BUILDING_H = 250;

const WINDOW_W = 4;
const WINDOW_H = 5;
const WINDOW_GAP_X = 4;
const WINDOW_GAP_Y = 5;

// холодный (старое) -> тёплый (свежее)
const COLD = [0x4a, 0x6f, 0xa5];
const WARM = [0xff, 0xa0, 0x4a];

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

// Псевдослучайное число из строки — чтобы силуэт города и рисунок окон
// не менялись хаотично между запусками в один и тот же день.
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

function lerpColor(a, b, t) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

async function main() {
  const days = await fetchContributions();
  const active = days.filter(d => d.contributionCount > 0);

  if (active.length === 0) {
    console.log('No activity found — nothing to render.');
    return;
  }

  const maxCount = Math.max(...active.map(d => d.contributionCount));

  // Ширина зданий подгоняется так, чтобы весь город уместился по горизонтали.
  const padding = 24;
  const usableWidth = WIDTH - padding * 2;
  const baseSlot = usableWidth / active.length;

  let x = padding;
  const buildings = [];

  active.forEach((d, i) => {
    const rand = seededRandom(d.date);

    // Логарифмическая шкала: один аномально активный день не должен
    // сплющивать все остальные здания в плинтус.
    const norm = Math.log2(d.contributionCount + 1) / Math.log2(maxCount + 1);
    const height = MIN_BUILDING_H + norm * (MAX_BUILDING_H - MIN_BUILDING_H);

    // Лёгкая вариация ширины, чтобы силуэт не был гребёнкой из клонов.
    const width = Math.max(10, baseSlot * (0.72 + rand() * 0.5));

    // Свежесть: 0 — самый старый день в истории, 1 — самый свежий.
    const freshness = active.length > 1 ? i / (active.length - 1) : 1;
    const windowColor = lerpColor(COLD, WARM, freshness);

    buildings.push({
      x,
      width,
      height,
      y: GROUND_Y - height,
      date: d.date,
      count: d.contributionCount,
      norm,
      windowColor,
      rand,
    });

    x += baseSlot;
  });

  // --- рендер зданий ---
  let cityMarkup = '';

  buildings.forEach(b => {
    const bodyShade = 0.06 + b.norm * 0.05;
    const bodyColor = `rgba(20,26,40,${(0.85 + bodyShade).toFixed(2)})`;

    cityMarkup += `<rect x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.width.toFixed(1)}" height="${b.height.toFixed(1)}" fill="${bodyColor}" stroke="#0d1220" stroke-width="0.8">
      <title>${b.date} — ${b.count} коммит(ов)</title>
    </rect>\n`;

    // Сетка окон внутри здания
    const innerPadX = 3;
    const innerPadY = 4;
    const cols = Math.max(1, Math.floor((b.width - innerPadX * 2 + WINDOW_GAP_X) / (WINDOW_W + WINDOW_GAP_X)));
    const rows = Math.max(1, Math.floor((b.height - innerPadY * 2 + WINDOW_GAP_Y) / (WINDOW_H + WINDOW_GAP_Y)));

    // Доля светящихся окон зависит от активности дня
    const litRatio = 0.25 + b.norm * 0.55;

    const gridW = cols * WINDOW_W + (cols - 1) * WINDOW_GAP_X;
    const startX = b.x + (b.width - gridW) / 2;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (b.rand() > litRatio) continue;

        const wx = startX + c * (WINDOW_W + WINDOW_GAP_X);
        const wy = b.y + innerPadY + r * (WINDOW_H + WINDOW_GAP_Y);

        // Разные фаза и период — город "дышит" вразнобой, а не мигает целиком
        const delay = (b.rand() * 6).toFixed(2);
        const duration = (3 + b.rand() * 3).toFixed(2);
        const baseOpacity = (0.55 + b.rand() * 0.35).toFixed(2);

        cityMarkup += `<rect class="win" x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${WINDOW_W}" height="${WINDOW_H}" fill="${b.windowColor}" opacity="${baseOpacity}" style="animation-delay:${delay}s;animation-duration:${duration}s"/>\n`;
      }
    }
  });

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#05070f"/>
      <stop offset="70%" stop-color="#0a1020"/>
      <stop offset="100%" stop-color="#131c33"/>
    </linearGradient>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b111d"/>
      <stop offset="100%" stop-color="#05070c"/>
    </linearGradient>
    <style>
      .win {
        animation-name: breathe;
        animation-timing-function: ease-in-out;
        animation-iteration-count: infinite;
      }
      @keyframes breathe {
        0%, 100% { opacity: 0.45; }
        50% { opacity: 1; }
      }
    </style>
  </defs>

  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="12" fill="url(#sky)"/>

  ${cityMarkup}

  <rect x="0" y="${GROUND_Y}" width="${WIDTH}" height="${HEIGHT - GROUND_Y}" fill="url(#ground)"/>
  <line x1="0" y1="${GROUND_Y}" x2="${WIDTH}" y2="${GROUND_Y}" stroke="#1a2740" stroke-width="1"/>

  <text x="20" y="${HEIGHT - 16}" fill="#5a6a85" font-family="monospace" font-size="11">${USERNAME} — город из ${active.length} активных дней</text>
</svg>`;

  fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'dist', 'constellation.svg'), svg);
  console.log(`Generated night city with ${buildings.length} buildings`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
