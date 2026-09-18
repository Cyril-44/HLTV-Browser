import * as cheerio from 'cheerio';
import { CheerioAPI } from 'cheerio';
import { MatchDetail, MapBlock, StatsTable, StatRow, LineupPlayer } from '../types';

export function parseMatchPage(html: string, url: string): MatchDetail {
  const $ = cheerio.load(html);

  const sb = $('#scoreboardElement');
  const idFromUrl = /\/matches\/(\d+)\//.exec(url);
  const id = sb.attr('data-scorebot-id') ? Number(sb.attr('data-scorebot-id')) : idFromUrl ? Number(idFromUrl[1]) : 0;

  // Header (sticky dropdown has teams + time regardless of live state)
  const team1Name = $('.dropdownTeam.team1 .teamName').first().text().trim() || $('.team1 .teamName').first().text().trim();
  const team2Name = $('.dropdownTeam.team2 .teamName').first().text().trim() || $('.team2 .teamName').first().text().trim();
  const team1Href = $('.dropdownTeam.team1').attr('href') ?? '';
  const team2Href = $('.dropdownTeam.team2').attr('href') ?? '';

  const timeEl = $('.dropdownTimeAndEvent .time[data-unix], .timeAndEvent .time[data-unix]').first();
  const startTime = timeEl.attr('data-unix') ? Number(timeEl.attr('data-unix')) : null;

  const eventLink = $('.timeAndEvent a[href*="/events/"]').first();
  const eventName = eventLink.find('.event-name').text().trim() || $('.timeAndEvent .event').first().text().trim();
  const eventHref = eventLink.attr('href') ?? '';
  const eventIdMatch = /\/events\/(\d+)/.exec(eventHref);

  // ".veto-box .padding.preformatted-text" holds "Best of 3 (LAN)  * Stage name"
  const preformatted = $('.veto-box .padding.preformatted-text').first().text().replace(/\s+/g, ' ').trim();
  const [formatPart, stagePart] = preformatted.split('*');
  const stage = (stagePart ?? '').trim();
  const format = (formatPart ?? '').trim();

  const live = sb.length > 0;

  const seriesScore = $('.teamsBox .score, .match-header-score, [class*="teamScore"]').first().text().trim();

  const vetoes: string[] = [];
  $('.veto-box').each((_, box) => {
    const $box = $(box);
    if ($box.find('.preformatted-text').length) {
      return;
    }
    for (const div of $box.find('.padding > div')) {
      const t = $(div).text().replace(/\s+/g, ' ').trim();
      if (/^\d+\./.test(t)) {
        vetoes.push(t);
      }
    }
  });

  const maps = parseMaps($);
  const { statMaps, stats } = parseStats($);
  const lineups = parseLineups($);

  return {
    id,
    url,
    team1: { id: teamId(team1Href), name: team1Name },
    team2: { id: teamId(team2Href), name: team2Name },
    startTime,
    event: { id: eventIdMatch ? Number(eventIdMatch[1]) : null, name: eventName },
    stage,
    format,
    live,
    seriesScore,
    vetoes,
    maps,
    statMaps,
    stats,
    lineups,
    scorebot: sb.attr('data-scorebot-id')
      ? {
          url: sb.attr('data-scorebot-url') ?? 'https://scorebot-lb.hltv.org',
          id: Number(sb.attr('data-scorebot-id')),
          team1Id: numOrNull(sb.attr('data-team1-id')),
          team2Id: numOrNull(sb.attr('data-team2-id')),
        }
      : null,
  };
}

function teamId(href: string): number | null {
  const m = /\/team\/(\d+)\//.exec(href);
  return m ? Number(m[1]) : null;
}

function numOrNull(v: string | undefined): number | null {
  return v && /^\d+$/.test(v) ? Number(v) : null;
}

function parseMaps($: CheerioAPI): MapBlock[] {
  const maps: MapBlock[] = [];
  for (const el of $('.mapholder')) {
    const $el = $(el);
    const name = $el.find('.mapname').first().text().trim() || $el.find('[class*="map-name"]').first().text().trim();
    if (!name) {
      continue;
    }
    const score1 = $el.find('.results-left .results-team-score').first().text().trim();
    const score2 = $el.find('.results-right .results-team-score').first().text().trim();
    const halves = $el.find('.results-center-half-score').first().text().replace(/\s+/g, '').trim();
    const statsUrl = $el.find('a.results-stats').attr('href') ?? '';
    maps.push({
      name,
      score1: score1 || '-',
      score2: score2 || '-',
      halves,
      statsUrl,
    });
  }
  return maps;
}

function parseStats($: CheerioAPI): { statMaps: { id: string; name: string }[]; stats: { [mapId: string]: StatsTable[] } } {
  const statMaps: { id: string; name: string }[] = [];
  for (const el of $('.stats-menu-link')) {
    const $el = $(el);
    const name = $el.find('.dynamic-map-name-full').first().text().trim();
    const id = $el.find('.dynamic-map-name-full').attr('id') ?? $el.find('[id]').first().attr('id');
    if (name && id) {
      statMaps.push({ id: String(id), name });
    }
  }

  const stats: { [mapId: string]: StatsTable[] } = {};
  for (const content of $('.stats-content')) {
    const $content = $(content);
    const contentId = $content.attr('id') ?? 'all';
    const mapId = contentId.replace(/-content$/, '');
    const tables: StatsTable[] = [];
    for (const table of $content.find('table.totalstats')) {
      const $table = $(table);
      const team = $table.find('.teamName').first().text().trim();
      const rows: StatRow[] = [];
      for (const tr of $table.find('tr')) {
        const $tr = $(tr);
        const nameCell = $tr.find('.players .statsPlayerName').first();
        if (!nameCell.length) {
          continue;
        }
        const nick = $tr.find('.player-nick').first().text().trim() || nameCell.text().trim();
        const player = nameCell.text().replace(/\s+/g, ' ').trim();
        rows.push({
          player,
          nick,
          kd: cell($tr, 'kd', 'traditional-data'),
          ekd: cell($tr, 'kd', 'eco-adjusted-data'),
          swing: cell($tr, 'roundSwing', ''),
          adr: cell($tr, 'adr', 'traditional-data'),
          eadr: cell($tr, 'adr', 'eco-adjusted-data'),
          kast: cell($tr, 'kast', 'traditional-data'),
          ekast: cell($tr, 'kast', 'eco-adjusted-data'),
          rating: $tr.find('td.rating').first().text().trim(),
          ratingClass: $tr.find('td.rating').first().attr('class') ?? '',
        });
      }
      if (team && rows.length) {
        tables.push({ team, rows });
      }
    }
    if (tables.length) {
      stats[mapId] = tables;
    }
  }
  return { statMaps, stats };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cell($tr: cheerio.Cheerio<any>, base: string, variant: string): string {
  const sel = variant ? `td.${base}.${variant}` : `td.${base}`;
  return $tr.find(sel).first().text().trim();
}

function parseLineups($: CheerioAPI): { team: string; players: LineupPlayer[] }[] {
  const lineups: { team: string; players: LineupPlayer[] }[] = [];
  for (const box of $('.lineups .lineup')) {
    const $box = $(box);
    const team = $box.find('.box-headline a.text-ellipsis').first().text().trim();
    if (!team) {
      continue;
    }
    const players: LineupPlayer[] = [];
    // Finished-match layout: td.player > a[href^="/player/"] with the full
    // name on the bodyshot img's title attribute.
    for (const a of $box.find('a[href^="/player/"]')) {
      const $a = $(a);
      const fullName = (
        $a.find('img[title]').first().attr('title') ||
        $a.find('img').first().attr('alt') ||
        $a.text() ||
        ''
      ).replace(/\s+/g, ' ').trim();
      if (!fullName) {
        continue;
      }
      const quoted = /'([^']+)'/.exec(fullName);
      players.push({ nick: quoted?.[1] ?? fullName, fullName });
    }
    // Live-match layout: .player-compare containers carry the name on title.
    if (!players.length) {
      for (const pc of $box.find('.player-compare')) {
        const $pc = $(pc);
        const fullName = ($pc.attr('title') || $pc.find('img').attr('title') || $pc.find('img').attr('alt') || '').replace(/\s+/g, ' ').trim();
        if (!fullName) {
          continue;
        }
        const quoted = /'([^']+)'/.exec(fullName);
        players.push({ nick: quoted?.[1] ?? fullName, fullName });
      }
    }
    if (players.length) {
      lineups.push({ team, players });
    }
  }
  return lineups;
}
