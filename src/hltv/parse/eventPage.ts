import * as cheerio from 'cheerio';
import { EventDetail, EventTeam, BracketSection, BracketMatchup } from '../types';

interface RawSlotTeam {
  type?: string;
  name?: string;
  description?: string;
}

interface RawMatchup {
  match?: { matchPageURL?: string; startTime?: number } | null;
  score?: { team1Score?: number; team2Score?: number } | null;
  team1?: RawSlotTeam;
  team2?: RawSlotTeam;
}

interface RawBracket {
  name?: string;
  type?: string;
  upperTierName?: string;
  lowerTierName?: string;
  [key: string]: unknown;
}

export function parseEventPage(html: string, url: string): EventDetail {
  const $ = cheerio.load(html);

  const unixSpans = $('.event-header-component [data-unix]').map((_, s) => Number($(s).attr('data-unix'))).get();
  const dateStart = unixSpans.length ? Math.min(...unixSpans) : null;
  const dateEnd = unixSpans.length ? Math.max(...unixSpans) : null;

  const info = $('.event-header-component table.info');
  const prizeTd = info.find('td.prizepool').first();
  const prize = prizeTd.attr('title')?.trim() || prizeTd.text().replace(/\s+/g, ' ').trim();
  const teamsCount = info.find('td.teamsNumber').first().text().trim();
  const location = info.find('td.location').first().text().replace(/\s+/g, ' ').trim();

  const formats: { name: string; value: string }[] = [];
  for (const tr of $('table.formats tr')) {
    const $tr = $(tr);
    const name = $tr.find('.format-header').text().trim();
    const value = $tr.find('.format-data').text().trim();
    if (name) {
      formats.push({ name, value });
    }
  }

  const teams: EventTeam[] = [];
  for (const box of $('.teams-attending .team-box')) {
    const $box = $(box);
    const name = $box.find('.team-name .text').first().text().trim();
    const href = $box.find('.team-name a[href*="/team/"]').attr('href') ?? '';
    const m = /\/team\/(\d+)\//.exec(href);
    teams.push({
      id: m ? Number(m[1]) : null,
      name,
      logo: $box.find('.logo-box img.logo').attr('src') ?? '',
      worldRank: $box.find('.event-world-rank').first().text().trim(),
      vrsRank: $box.find('.event-vrs-rank').first().text().trim(),
    });
  }

  const brackets: BracketSection[] = [];
  const bracketHtmlParts: string[] = [];
  for (const ph of $('[data-slotted-bracket-json]')) {
    const $ph = $(ph);
    let raw: string;
    try {
      raw = JSON.parse(`"${($ph.attr('data-slotted-bracket-json') ?? '').replace(/"/g, '\\"')}"`) as string;
      raw = $ph.attr('data-slotted-bracket-json') ?? '';
      // cheerio already decodes HTML entities in attribute values
    } catch {
      raw = $ph.attr('data-slotted-bracket-json') ?? '';
    }
    let json: RawBracket;
    try {
      json = JSON.parse(raw) as RawBracket;
    } catch {
      continue;
    }
    // native path: keep the RENDERED bracket DOM (the site renders the
    // component into this wrapper); the JSON cards stay as fallback. The
    // rendered slots carry no links — inject them by pairing each rendered
    // .match with the JSON matchup holding the same team names.
    const clone = $ph.clone();
    const urlByName = collectMatchUrlsByName(json);
    if (Object.keys(urlByName).length) {
      clone.find('.match').each((_, m) => {
        const $m = $(m);
        const names = $m
          .find('.team-name')
          .map((_, n) => $(n).text().trim())
          .get()
          .filter(Boolean)
          .sort();
        if (names.length < 2) {
          return;
        }
        const url = urlByName[`${names[0]}|${names[1]}`];
        if (url) {
          $m.attr('data-url', url).addClass('bracket-match');
        }
      });
    }
    // a placeholder without rendered matchups (playoffs not drawn yet — e.g.
    // during the swiss stage) renders as an empty gray strip: skip it
    if (clone.find('.match, .team-name').length) {
      bracketHtmlParts.push(sanitizeEventDom($, clone));
    }
    const sectionTitle = $ph.prevAll('.section-header').first().find('span').text().trim() || json.name || 'Bracket';
    brackets.push({ title: sectionTitle, rounds: extractRounds(json) });
  }

  // swiss rounds: the whole visual container renders natively (CSS is scoped
  // under .swiss-visual-container); text cards stay as fallback
  const swissContainer = $('.swiss-visual-container').first();
  let swissHtml = '';
  if (swissContainer.length) {
    const swissClone = swissContainer.clone();
    // swiss matchups carry no links — each has data-match-details-popup-json
    // with a matchId; expose it as a clickable block (openMatch normalizes
    // the slug away, so a placeholder slug is fine)
    swissClone.find('.swiss-visual-matchup').each((_, mu) => {
      const $mu = $(mu);
      const popup = $mu.attr('data-match-details-popup-json') ?? '';
      const id = /"matchId"\s*:\s*\{?"?matchId"?\s*:\s*"?(\d+)/.exec(popup)?.[1];
      if (id) {
        $mu.attr('data-url', `/matches/${id}/matchup`).addClass('bracket-match');
      }
    });
    swissHtml = sanitizeEventDom($, swissClone);
  }

  const cssUrls = $('link[rel="stylesheet"]')
    .map((_, l) => $(l).attr('href') ?? '')
    .get()
    .filter((h) => /\.css(\?|$)/.test(h));

  const relatedEvents: { name: string; url: string }[] = [];
  for (const a of $('.related-event a[href*="/events/"], .related-events a[href*="/events/"]')) {
    const $a = $(a);
    const href = $a.attr('href') ?? '';
    if (/\/events\/\d+(\/|$)/.test(href)) {
      relatedEvents.push({ name: $a.text().replace(/\s+/g, ' ').trim(), url: href });
    }
  }

  // Swiss-format visual columns ("0:0", "1:0", ...) each list that round's matchups.
  const swiss: { title: string; matchups: string[] }[] = [];
  for (const col of $('.swiss-visual-column')) {
    const $col = $(col);
    const title = $col.find('.swiss-visual-matchups-title').first().text().trim();
    const matchups: string[] = [];
    for (const mu of $col.find('.swiss-visual-matchup')) {
      const $mu = $(mu);
      // Team names live on the logo img's title attribute; "?" is a placeholder.
      const teams = $mu
        .find('.swiss-visual-team img')
        .map((_, img) => ($(img).attr('title') ?? '').trim())
        .get()
        .filter((n) => n && n !== '?');
      const score = $mu.find('[class*="score"]').first().text().replace(/\s+/g, ' ').trim();
      if (teams.length === 2) {
        matchups.push(teams.join(' vs ') + (score ? ` ${score}` : ''));
      }
      // unannounced matchups (placeholder "?") are simply skipped — a wall
      // of "TBD vs TBD" lines carries no information
    }
    if (title || matchups.length) {
      swiss.push({ title, matchups });
    }
  }

  return {
    url,
    name: $('.event-hub-title').first().text().trim() || $('h1').first().text().trim(),
    dateStart,
    dateEnd,
    prize,
    teamsCount,
    location,
    formats,
    teams,
    brackets,
    swiss,
    relatedEvents,
    bracketHtml: bracketHtmlParts.join('\n'),
    swissHtml,
    cssUrls,
  };
}

/** team-name-pair → match page url, from the bracket JSON (both orders). */
function collectMatchUrlsByName(json: RawBracket): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (obj: unknown): void => {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (/^slot/.test(key) && value && typeof value === 'object') {
        const mu = (value as { matchup?: RawMatchup }).matchup;
        const url = mu?.match?.matchPageURL;
        const a = mu?.team1?.name?.trim();
        const b = mu?.team2?.name?.trim();
        if (url && a && b && a !== 'TBD' && b !== 'TBD') {
          const [x, y] = [a, b].sort();
          out[`${x}|${y}`] = url;
        }
      } else {
        visit(value);
      }
    }
  };
  visit(json);
  return out;
}

/**
 * Sanitize a rendered event section (bracket / swiss rounds) for native
 * webview display. Unlike the news sanitizer we KEEP inline styles — the
 * bracket layout (tier heights, round offsets) is driven by them. Team logos
 * become opt-in media slots (original classes kept so site sizing applies)
 * and links are tagged for in-editor routing.
 */
function sanitizeEventDom($: cheerio.CheerioAPI, root: ReturnType<cheerio.CheerioAPI>): string {
  root.find('script, style, ins, .tooltip-con').remove();
  root.removeAttr('data-slotted-bracket-json');
  root.find('img').each((_, img) => {
    const $img = $(img);
    const raw = $img.attr('src') ?? '';
    if (!raw) {
      $img.remove();
      return;
    }
    const srcUrl = raw.startsWith('/') ? `https://www.hltv.org${raw}` : raw;
    const keptClass = ($img.attr('class') ?? '').replace(/["'<>]/g, '');
    // keep the title: swiss team names live on the logo img's title attr and
    // the hover tooltip reads them from the slot
    const title = ($img.attr('title') ?? '').replace(/["<>]/g, '');
    const titleAttr = title ? ` title="${title}"` : '';
    const slot = $(
      `<span class="media-slot ${keptClass}"${titleAttr} data-kind="image" data-src="${srcUrl.replace(/"/g, '&quot;')}"></span>`,
    );
    $img.replaceWith(slot);
  });
  root.find('a').each((_, a) => {
    $(a).addClass('natlink');
  });
  // outer html of the wrapper itself — its class/inline style drive layout
  return $('<div></div>').append(root).html() ?? '';
}

function extractRounds(json: RawBracket): { name: string; matchups: BracketMatchup[] }[] {
  const rounds: { name: string; matchups: BracketMatchup[] }[] = [];

  const readRound = (container: unknown, fallbackName: string): void => {
    if (!container || typeof container !== 'object') {
      return;
    }
    const obj = container as Record<string, unknown>;
    const roundNameRaw = obj.roundName as { name?: string; shortName?: string } | undefined;
    const roundName = roundNameRaw?.name ?? roundNameRaw?.shortName ?? fallbackName;
    const matchups: BracketMatchup[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (!/^slot/.test(key) || !value || typeof value !== 'object') {
        continue;
      }
      const mu = (value as { matchup?: RawMatchup }).matchup;
      if (!mu) {
        continue;
      }
      matchups.push(matchupToItem(mu));
    }
    if (matchups.length) {
      rounds.push({ name: roundName, matchups });
    }
  };

  const upper = json.upperTierName ?? 'Upper Bracket';
  const lower = json.lowerTierName ?? 'Lower Bracket';
  for (const [key, value] of Object.entries(json)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const vo = value as Record<string, unknown>;
      if ('roundName' in vo || /^slot/.test(Object.keys(vo)[0] ?? '')) {
        const prefix = key.startsWith('lower') ? lower : key.startsWith('upper') ? upper : '';
        readRound(vo, prefix ? `${prefix} · ${key}` : key);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        readRound(item, 'Round');
      }
    }
  }
  return rounds;
}

function matchupToItem(mu: RawMatchup): BracketMatchup {
  const team1 = mu.team1?.name ?? mu.team1?.description ?? mu.team2?.description ?? 'TBD';
  const team2 = mu.team2?.name ?? mu.team2?.description ?? 'TBD';
  return {
    label: '',
    matchUrl: mu.match?.matchPageURL ?? null,
    startTime: mu.match?.startTime ?? null,
    team1,
    team2,
    score1: mu.score?.team1Score ?? null,
    score2: mu.score?.team2Score ?? null,
  };
}
