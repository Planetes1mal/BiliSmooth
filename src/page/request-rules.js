// Shared shape tests for intercepted requests. Pure functions, no state.
export const readUrl = value => typeof value === 'string' ? value : value?.href || value?.url || '';
// Response bodies worth inspecting for media addresses.
export const textual = type => typeof type === 'string' && /json|text/i.test(type);
// Requests that can carry a playinfo payload or media.
export const relevant = value => /\/x\/player|\/pgc\/player|playurl|getRoomPlayInfo|bilivideo/i.test(value || '');
// Text that mentions a media delivery host.
export const signalText = value => typeof value === 'string' && /bilivideo|upgcxcode|mcdn|akamaized|mountaintoys|nexusedgeio|szbdyd|ahdohpiechei/i.test(value);
