const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// CHANGELOG is the only source for the GitHub release body and packaged notes.
export function extractReleaseNotes(changelog, version) {
  const headings = [...changelog.matchAll(/^## (.+)\r?$/gm)];
  const matching = headings.filter(row => new RegExp(`^${escape(version)} — (\\d{4}-\\d{2}-\\d{2})$`).test(row[1].trim()));
  if (matching.length !== 1) throw new Error(`Expected exactly one dated CHANGELOG heading: ## ${version} — YYYY-MM-DD`);
  const section = matching[0], date = section[1].trim().slice(-10);
  const end = headings[headings.indexOf(section) + 1]?.index ?? changelog.length;
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
    throw new Error('CHANGELOG release date is invalid.');
  const body = changelog.slice(section.index + section[0].length, end).trim();
  if (!body) throw new Error('CHANGELOG release section must not be empty.');
  return { date, body: `${body}\n`, notesPath: `outputs/release-notes-${version}.md` };
}
