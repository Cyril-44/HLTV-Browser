#!/usr/bin/env python3
"""Generate synthetic HLTV page fixtures for the offline test suites.

The parsers only depend on specific selector families; these fixtures
reconstruct them so `run-lazy-check.cjs` / `parse-check.ts` never need live
fetches. Real captures can replace any file one-to-one.

Usage: python3 scripts/gen-fixtures.py [--out /tmp/pwtest/out]
"""
import os
import sys
import shutil

OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else '/tmp/pwtest/out'
os.makedirs(OUT, exist_ok=True)

TEAM = '<img src="/x.png" class="match-team-logo" title="{t}">'


def match_wrapper(mid, t1, t2, ev, eid, stars, live, lan, unix=None):
    live_attr = 'live="true"' if live else 'live="false"'
    time_html = (
        '<div class="match-meta matchLive">Live</div>' if live else
        f'<div class="match-time" data-time-format="HH:mm" data-unix="{unix}">17:30</div>'
    )
    return f'''
<div class="match-wrapper" data-match-wrapper="" data-match-id="{mid}" data-stars="{stars}"
     data-event-id="{eid}" lan="{lan}" {live_attr} team1="1" team2="2">
  <a href="/matches/{mid}/{t1}-vs-{t2}-x" class="match-top a-reset">
    <div class="match-event text-ellipsis" data-event-headline="{ev}" data-event-id="{eid}"><div class="text-ellipsis">{ev}</div></div>
  </a>
  <div class="match-bottom">
    <a href="/matches/{mid}/{t1}-vs-{t2}-x" class="match-info a-reset">{time_html}<div class="match-meta">bo3</div></a>
    <a href="/matches/{mid}/{t1}-vs-{t2}-x" class="match-teams text-ellipsis a-reset">
      <div class="match-team team1">{TEAM.format(t=t1)}<div class="match-teamname text-ellipsis">{t1}</div></div>
      <div class="match-team team2">{TEAM.format(t=t2)}<div class="match-teamname text-ellipsis">{t2}</div></div>
    </a>
  </div>
</div>'''


MATCHES = f'''<html><body><div class="match-page">
<div class="liveMatches" data-scorebot-url="https://scorebot-lb.hltv.org">
  {match_wrapper(2398090, 'Natus Vincere', 'Aurora', 'StarLadder StarSeries Fall 2026', 8057, 3, True, True)}
</div>
<div class="matches-list-section">
  <a href="/events/8057/starladder-x"><div class="event-headline-text">StarLadder StarSeries Fall 2026<span class="event-type-tag type-lan">Lan</span></div></a>
  <div class="matches-list" match-parent="">
    {match_wrapper(2398091, 'FURIA', 'MIBR', '', 8057, 2, False, True, 1789666200000)}
  </div>
</div>
</div></body></html>'''


def stats_tables(team, nicks):
    rows = ''.join(
        f'''<tr><td class="players"><div class="flagAlign"><a href="/player/{i}/x" class="text-ellipsis">
        <div class="gtSmartphone-only statsPlayerName text-ellipsis">F '<span class="player-nick">{n}</span>' L</div></a></div></td>
        <td class="kd text-center traditional-data">{i}-1</td><td class="kd text-center eco-adjusted-data hidden">{i}-2</td>
        <td class="roundSwing text-center">+0.1%</td>
        <td class="adr text-center traditional-data">8{i}.0</td><td class="adr text-center eco-adjusted-data hidden">9{i}.0</td>
        <td class="kast text-center traditional-data">7{i}.0%</td><td class="kast text-center eco-adjusted-data hidden">7{i}.0%</td>
        <td class="rating text-center ratingPositive">1.{i}</td></tr>'''
        for i, n in enumerate(nicks, 1)
    )
    head = f'''<tr class="header-row"><td class="players"><a href="/team/1/{team}" class="teamName team">{team}</a></td>
      <td class="kd text-center traditional-data">K-D</td><td class="kd text-center eco-adjusted-data hidden">eK-eD</td>
      <td class="roundSwing text-center">Swing</td>
      <td class="adr text-center traditional-data">ADR</td><td class="adr text-center eco-adjusted-data hidden">eADR</td>
      <td class="kast text-center traditional-data">KAST</td><td class="kast text-center eco-adjusted-data hidden">eKAST</td>
      <td class="rating text-center">Rating<span class="ratingDesc">3.0</span></td></tr>'''
    mk = lambda cls: f'<table class="table {cls}"><tbody>{head}{rows}</tbody></table>'
    return mk('totalstats') + mk('tstats hidden') + mk('ctstats hidden')


def lineup_cells(prefix, nicks):
    return ''.join(
        '<td class="player player-image"><div class="player-compare " data-player-id="%d" title="F \'%s\' L"><img title="F \'%s\' L"></div></td>'
        % (prefix + i, n, n) for i, n in enumerate(nicks)
    )


LIVEMATCH = f'''<html><body><div class="match-page">
<div class="standard-box teamsBoxDropdown smartphone-only">
  <a href="/team/1/natus-vincere" class="dropdownTeam team1 text-ellipsis"><div class="teamName">Natus Vincere</div></a>
  <div class="dropdownTimeAndEvent"><div class="time" data-time-format="HH:mm" data-unix="1789657500000">15:05</div></div>
  <a href="/team/2/aurora" class="dropdownTeam team2 text-ellipsis"><div class="teamName">Aurora</div></a>
</div>
<div class="timeAndEvent"><div class="time" data-unix="1789657500000">15:05</div>
  <a href="/events/8057/starladder-x"><div class="event text-ellipsis">StarLadder StarSeries Fall 2026</div></a></div>
<div id="scoreboardElement" class="live-map-de_mirage" data-scorebot-url="https://scorebot-lb.hltv.org"
  data-team1-name="Natus Vincere" data-team2-name="Aurora" data-scorebot-id="2398090"
  data-team1-id="4608" data-team2-id="11861"></div>
<div class="g-grid maps">
  <div class="standard-box veto-box"><div class="padding preformatted-text">Best of 3 (LAN)  * Upper bracket quarter-final</div></div>
  <div class="standard-box veto-box"><div class="padding"><div>1. Aurora removed Ancient</div><div>2. Natus Vincere removed Dust2</div>
    <div>3. Aurora picked Nuke</div><div>7. Cache was left over</div></div></div>
  <div class="flexbox-column">
    <div class="mapholder"><div class="played"><div class="map-name-holder"><div class="mapname">Nuke</div></div></div>
      <div class="results played"><div class="results-left lost"><div class="results-teamname text-ellipsis">Natus Vincere</div><div class="results-team-score">8</div></div>
      <div class="results-center"><div class="results-center-stats"><a href="/stats/matches/mapstatsid/238528/x" class="results-stats">STATS</a></div>
      <div class="results-center-half-score"><span>(</span><span class="ct">7</span><span>:</span><span class="t">5</span><span>; </span><span class="t">1</span><span>:</span><span class="ct">8</span><span>)</span></div></div>
      <span class="results-right won pick"><div class="results-teamname text-ellipsis">Aurora</div><div class="results-team-score">13</div></span></div></div>
    <div class="mapholder"><div class="played"><div class="map-name-holder"><div class="mapname">Mirage</div></div></div>
      <div class="results played"><div class="results-left"><div class="results-teamname text-ellipsis"></div></div></div></div>
  </div>
</div>
<div class="spoiler"><div class="matchstats" id="match-stats">
  <div class="stats-content" id="all-content">{stats_tables('Natus Vincere', ['b1t', 'makazze'])}{stats_tables('Aurora', ['Jimpphat', 'XANTARES'])}</div>
  <div class="stats-content" id="238528-content">{stats_tables('Natus Vincere', ['b1t', 'makazze'])}{stats_tables('Aurora', ['Jimpphat', 'XANTARES'])}</div>
</div></div>
<div class="lineups" id="lineups"><span class="headline">Lineups</span>
  <div class="lineup standard-box"><div class="box-headline flex-align-center"><a href="/team/1/x" class="text-ellipsis">Natus Vincere</a></div>
    <div class="players"><table class="table"><tbody><tr>
      {lineup_cells(100, ['b1t', 'makazze'])}</tr></tbody></table></div></div>
  <div class="lineup standard-box"><div class="box-headline flex-align-center"><a href="/team/2/x" class="text-ellipsis">Aurora</a></div>
    <div class="players"><table class="table"><tbody><tr>
      {lineup_cells(200, ['Jimpphat', 'XANTARES'])}</tr></tbody></table></div></div>
</div>
<div><span class="headline">Matches, past 3 months</span>
  <div class="past-matches-grid hidden" data-past-matches-team="">
    <div class="past-matches-box text-ellipsis"><div class="past-matches-headline"><div class="past-matches-teamname text-ellipsis"><a href="/team/1/x">Natus Vincere</a></div></div>
      <div class="past-matches-scroll-area"><table class="past-matches-table"><tbody>
        <tr><td class="past-matches-team text-ellipsis"><div class="past-matches-name-time"><div class="past-matches-cell past-matches-teamname text-ellipsis"><span class="text-ellipsis"><a href="/team/9/g2" class="text-ellipsis">G2</a></span></div><div class="past-matches-cell past-matches-time-ago">3 weeks ago</div></div></td>
        <td class="past-matches-map"><div class="past-matches-cell"><a href="/matches/9/g2">bo3</a></div></td>
        <td class="past-matches-score"><a href="/matches/9/g2" class="past-matches-cell lost">0 - 2</a></td></tr>
      </tbody></table></div></div>
    <div class="past-matches-box text-ellipsis"><div class="past-matches-headline"><div class="past-matches-teamname text-ellipsis"><a href="/team/2/x">Aurora</a></div></div>
      <div class="past-matches-scroll-area"><table class="past-matches-table"><tbody>
        <tr><td class="past-matches-team text-ellipsis"><div class="past-matches-name-time"><div class="past-matches-cell past-matches-teamname text-ellipsis"><span class="text-ellipsis"><a href="/team/8/m80" class="text-ellipsis">M80</a></span></div><div class="past-matches-cell past-matches-time-ago">1 week ago</div></div></td>
        <td class="past-matches-map"><div class="past-matches-cell"><a href="/matches/8/m80">bo3</a></div></td>
        <td class="past-matches-score"><a href="/matches/8/m80" class="past-matches-cell won">2 - 0</a></td></tr>
      </tbody></table></div></div>
  </div>
</div>
</div></body></html>'''


def result_con(mid, t1, t2, s1, s2, ev, unix, bo='bo3'):
    return f'''<div class="result-con" data-zonedgrouping-entry-unix="{unix}"><a href="/matches/{mid}/{t1}-vs-{t2}-x" class="a-reset">
<div class="result"><table><tbody><tr>
<td class="team-cell"><div class="line-align team1"><div class="team {'team-won' if s1 > s2 else ''}">{t1}</div></div></td>
<td class="result-score"><span class="{'score-won' if s1 > s2 else 'score-lost'}">{s1}</span> - <span class="{'score-won' if s2 > s1 else 'score-lost'}">{s2}</span></td>
<td class="team-cell"><div class="line-align team2"><div class="team {'team-won' if s2 > s1 else ''}">{t2}</div></div></td>
<td class="event"><span class="event-name">{ev}</span></td>
<td class="star-cell"><div class="map-and-stars"><div class="map map-text">{bo}</div></div></td>
</tr></tbody></table></div></a></div>'''


RESULTS = '<html><body><div class="results-holder allres"><div class="results-all">' + ''.join([
    result_con(1, 'Vitality', 'magic', 2, 0, 'StarLadder StarSeries Fall 2026', 1789660948000),
    result_con(2, 'FURIA', 'MIBR', 2, 1, 'StarLadder StarSeries Fall 2026', 1789660534000),
    result_con(3, 'MOUZ', 'B8', 0, 2, 'CCT 2026', 1789657302000, 'bo1'),
]) + '</div></div></body></html>'


EVENTS = '''<html><body><div class="events-holder">
<div class="tab-content " id="FEATURED"><div class="ongoing-events-holder"><div class="ongoing-event-holder">
<a href="/events/8057/starladder-x" class="a-reset ongoing-event"><div class="content standard-box">
<div class="table-holder"><table class="table"><tbody>
<tr><td class="event-name-col" colspan="2"><div class="event-name-small"><div class="text-ellipsis">StarLadder StarSeries Fall 2026</div><div class="lan-marker">LAN</div></div></td></tr>
<tr class="eventDetails"><td><span class="col-desc"><span><span data-time-format="MMM do" data-unix="1789639200000">Sep 17th</span> - <span data-time-format="MMM do" data-unix="1789898400000">Sep 20th</span></span></span></td><td></td></tr>
</tbody></table></div></div></a></div></div></div>
<div class="events-month"><div class="standard-headline">October 2026</div><div class="big-events">
<a href="/events/8244/esl-pro-league-season-24" class="a-reset standard-box big-event"><div class="big-event-info">
<div class="big-event-name">ESL Pro League Season 24</div>
<div class="location-top-teams"><div><span class="big-event-location">Katowice, Poland</span></div></div>
<table class="table"><tbody><tr><th class="headline eventdate">Date</th><th class="headline prizepool">Prize pool</th><th class="headline teamsNumber">Teams</th></tr>
<tr><td class="col-value col-date"><span data-unix="1791021600000">Oct 3rd</span></td><td class="col-value small-col prizePoolEllipsis" title="$750,000">$750,000</td><td class="col-value small-col">32</td></tr></tbody></table>
</div></a></div>
<a href="/events/9317/ukic-masters-x" class="a-reset small-event standard-box"><div class="event-logo-container"></div>
<div class="table-holder"><table class="table"><tbody><tr><th>Date</th><th>Prize pool</th><th>Teams</th><th>Type</th></tr>
<tr><td class="col-value col-date">Sep 19th</td><td class="col-value small-col prizePoolEllipsis" title="$3,366">$3,366</td><td class="col-value small-col">2</td><td class="col-value small-col gtSmartphone-only">Local LAN</td></tr></tbody></table></div></a>
</div></div></body></html>'''


bracket_json = ('{"type":"org.hltv.bracket.model.Bracket.SingleElimination","bracketId":{"id":5439},'
 '"rounds":[{"type":"Round.Round4","roundName":{"name":"Quarter-finals"},"slots":'
 '{"slot1":{"matchup":{"match":{"matchId":1,"matchPageURL":"/matches/1/vitality-vs-magic-x"},"score":{"team1Score":2,"team2Score":0},'
 '"team1":{"type":"Known","name":"Vitality"},"team2":{"type":"Known","name":"magic"}}},'
 '"slot2":{"matchup":{"team1":{"type":"TextDescription","description":"TBD"},"team2":{"type":"TextDescription","description":"TBD"}}}}]}]}')

EVENT_DETAIL = f'''<html><body>
<div class="event-header-component standard-box padding no-top-border"><table class="info"><thead><tr>
<th class="headline eventdate">Date</th><th class="headline prizepool">Prize pool</th><th class="headline teamsNumber">Teams</th><th class="headline location">Location</th></tr></thead>
<tbody><tr><td class="eventdate"><span data-time-format="MMM do" data-unix="1789639200000">Sep 17th</span> - <span data-unix="1789898400000">Sep 20th</span></td>
<td class="prizepool text-ellipsis" title="$500,000">$500,000</td><td class="teamsNumber">8</td>
<td class="location gtSmartphone-only"><span class="flag-align"><span>Barcelona, Spain</span></span></td></tr></tbody></table></div>
<table class="formats table"><tbody><tr><th class="format-header">Playoffs</th><td class="format-data">Double elimination Bo3 - Grand final Bo5</td></tr></tbody></table>
<div class="teams-attending grid">
<div class="col standard-box team-box supports-hover"><div class="team-name"><a href="/team/4494/mouz"><div class="text">MOUZ</div>
<div class="event-world-rank">#3</div></a></div><div class="logo-box"><img class="logo" src="/mouz.png"></div></div>
<div class="col standard-box team-box supports-hover"><div class="team-name"><a href="/team/4495/furia"><div class="text">FURIA</div>
<div class="event-world-rank">#4</div></a></div><div class="logo-box"><img class="logo" src="/furia.png"></div></div>
</div>
<div class="section-header brackets"><span id="Brackets">Playoffs</span></div>
<div class="slotted-bracket-placeholder" data-slotted-bracket-json="{bracket_json.replace('"', '&quot;')}"></div>
</body></html>'''

NEWS_ARTICLE = '''<html><body><article class="newsitem standard-box">
<h1 class="headline">Synthetic fixture interview</h1>
<div class="article-info"><span class="author"><span class="authorName">Tester</span></span>
<div class="date" data-unix="1789655880000">17-9-2026</div></div>
<div class="newsdsl"><div class="newstext-con">
<p class="headertext">Intro text of the fixture.</p>
<p class="news-block">Normal paragraph with an <a href="https://twitter.com/x">external link</a> and a <a href="/team/4548/cph-wolves">team link</a> inline.</p>
<p class="news-block"><strong>An entirely bold question?</strong></p>
<p class="news-block">Answer paragraph with<b> bold entity</b>.</p>
<blockquote><p class="news-block">Quoted pull line.</p></blockquote>
<div class="featured-quote"><div class="featured-quote-quote">That featured quote speech</div><div class="featured-quote-author"><a href="/player/1/x">William "mezii" Merriman</a></div></div>
<img class="newsitem-match-result-team-flag-left" src="/img/static/flags/30x20/EU.gif"/>
<img src="https://img-cdn.hltv.org/teamlogo/abc.png?w=50"/>
<iframe src="https://clips.twitch.tv/embed?clip=x"></iframe>
<hr/>
<div class="twocol"><div class="twocol-grid"><div class="twocol-col"><a href="/team/1/a"> BC.Game</a><br><a href="/team/2/b"> Ninjas in Pyjamas</a><br></div></div></div>
</div></div>
</article></body></html>'''

NAV = '<nav><a href="/matches">Matches</a><a href="/results">Results</a><a href="/events">Events</a></nav>'
for _k in list(globals()):
    pass

def with_nav(html):
    return html.replace('<body>', '<body>' + NAV, 1)


files = {
    'matches.html': with_nav(MATCHES),
    'livematch.html': with_nav(LIVEMATCH),
    'results.html': with_nav(RESULTS),
    'events.html': with_nav(EVENTS),
    'event-starladder.html': EVENT_DETAIL,
    'news-article-1.html': NEWS_ARTICLE,
}
for name, content in files.items():
    with open(os.path.join(OUT, name), 'w') as f:
        f.write(content)
    print('wrote', name)

# reuse the fresh captures when present
for src, dst in [('/tmp/scan-home.html', 'newslist.html')]:
    if os.path.exists(src):
        shutil.copy(src, os.path.join(OUT, dst))
        print('copied', dst)
