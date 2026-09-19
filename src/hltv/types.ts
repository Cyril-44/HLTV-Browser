export interface TeamRef {
  id: number | null;
  name: string;
  logo?: string;
}

export interface EventRef {
  id: number | null;
  name: string;
}

export interface LiveScore {
  /** current map round score per team id */
  current: { [teamId: number]: number };
  /** maps won per team id */
  mapsWon: { [teamId: number]: number };
  maps: { name: string; ordinal: number; scores: { [teamId: number]: number }; over: boolean }[];
  updatedAt: number;
}

export interface Match {
  id: number;
  url: string;
  team1: TeamRef;
  team2: TeamRef;
  event: EventRef;
  startTime: number | null; // epoch ms
  format: string; // "bo3" | "bo1" ...
  stars: number;
  live: boolean;
  lan: boolean;
  region?: string;
  stage?: string;
  liveScore?: LiveScore;
}

export interface ResultMatch {
  id: number;
  url: string;
  team1: TeamRef;
  team2: TeamRef;
  score1: string;
  score2: string;
  event: EventRef;
  startTime: number | null; // epoch ms — per-row data-zonedgrouping-entry-unix
  format: string;
  stars: number;
}

export interface EventSummary {
  id: number;
  url: string;
  name: string;
  dateText: string;
  dateStart: number | null; // epoch ms
  prize: string;
  teamsCount: string;
  location: string;
  type: string;
  big: boolean;
  ongoing: boolean;
}

export interface EventTeam {
  id: number | null;
  name: string;
  logo: string;
  worldRank: string;
  vrsRank: string;
}

export interface BracketMatchup {
  label: string;
  matchUrl: string | null;
  startTime: number | null;
  team1: string;
  team2: string;
  score1: number | null;
  score2: number | null;
}

export interface BracketSection {
  title: string;
  rounds: { name: string; matchups: BracketMatchup[] }[];
}

export interface EventDetail {
  url: string;
  name: string;
  dateStart: number | null;
  dateEnd: number | null;
  prize: string;
  teamsCount: string;
  location: string;
  formats: { name: string; value: string }[];
  teams: EventTeam[];
  brackets: BracketSection[];
  swiss: { title: string; matchups: string[] }[];
  relatedEvents: { name: string; url: string }[];
}

export interface MapBlock {
  name: string;
  score1: string;
  score2: string;
  halves: string;
  statsUrl: string;
}

export interface StatRow {
  player: string;
  nick: string;
  kd: string;
  ekd: string;
  swing: string;
  adr: string;
  eadr: string;
  kast: string;
  ekast: string;
  rating: string;
  ratingClass: string;
}

export type StatSide = 'both' | 't' | 'ct';

export interface StatsTable {
  team: string;
  /** The match page embeds all three variants (totalstats/tstats/ctstats) and
   *  toggles visibility client-side — no extra request is ever needed. */
  side: StatSide;
  rows: StatRow[];
}

export interface LineupPlayer {
  nick: string;
  fullName: string;
}

export interface PastMatch {
  opponent: string;
  timeAgo: string;
  format: string;
  score: string;
  won: boolean | null; // null = draw/unknown
  url: string;
}

export interface TeamPastMatches {
  team: string;
  matches: PastMatch[];
}

export interface MatchDetail {
  id: number;
  url: string;
  team1: TeamRef;
  team2: TeamRef;
  startTime: number | null;
  event: EventRef;
  stage: string;
  format: string;
  live: boolean;
  seriesScore: string;
  vetoes: string[];
  maps: MapBlock[];
  statMaps: { id: string; name: string }[];
  stats: { [mapId: string]: StatsTable[] };
  lineups: { team: string; players: LineupPlayer[] }[];
  pastMatches: TeamPastMatches[];
  scorebot: {
    url: string;
    id: number;
    team1Id: number | null;
    team2Id: number | null;
  } | null;
}

export interface NewsItem {
  id: string;
  url: string;
  title: string;
  timeText: string;
  comments: string;
}

export interface NewsSegment {
  text: string;
  bold: boolean;
  italic: boolean;
}

export type NewsBlock =
  | { kind: 'text'; segments: NewsSegment[]; link?: string }
  | { kind: 'quote'; segments: NewsSegment[]; author?: string }
  | { kind: 'image'; src: string; label: string }
  | { kind: 'embed'; provider: string; src: string; label: string };

export interface NewsComment {
  num: string;
  author: string;
  fan: string;
  text: string;
  time: number | null;
  plus: string;
  depth: number;
}

export interface NewsDetail {
  url: string;
  title: string;
  author: string;
  date: number | null;
  intro: string;
  blocks: NewsBlock[];
  comments: NewsComment[];
}

// ---- scorebot wire types ----

export interface ScoreFrame {
  listId: number;
  wins: { [teamId: string]: number };
  mapScores: {
    [ordinal: string]: {
      map: string;
      mapOver: boolean;
      scores: { [teamId: string]: number };
      firstHalf: HalfScore | null;
      secondHalf: HalfScore | null;
    };
  };
  forcedLive: boolean;
}

export interface HalfScore {
  ctTeamDbId: number;
  ctScore: number;
  tTeamDbId: number;
  tScore: number;
}

export interface LogItem {
  [event: string]: unknown;
}
