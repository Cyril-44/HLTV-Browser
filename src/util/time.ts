const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatTime(epochMs: number): string {
  return timeFmt.format(new Date(epochMs));
}

export function formatDate(epochMs: number): string {
  return dateFmt.format(new Date(epochMs));
}

export function formatDateTime(epochMs: number): string {
  return dateTimeFmt.format(new Date(epochMs));
}

/** Date + local time, always including the date ("Fri 18 Sep 17:30"). */
export function formatMatchTime(epochMs: number): string {
  return `${formatDate(epochMs)} ${formatTime(epochMs)}`;
}
