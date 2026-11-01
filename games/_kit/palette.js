// Player colours, shared by the server (lib/rooms.mjs) and the browser.
// Warm to cool, high contrast on the dark background; no magenta.
export const COLORS = [
  '#ff6b6b', '#ffa94d', '#ffd43b', '#a9e34b', '#69db7c', '#38d9a9',
  '#63e6be', '#4dabf7', '#74c0fc', '#748ffc', '#b197fc', '#d0bfff',
  '#ff8787', '#ffc078',
];

// Team colours: up to 6 teams, each one clearly distinct from the others.
export const TEAM_COLORS = ['#5b8cff', '#ff5d73', '#51cf66', '#ffb347', '#9d7bff', '#4dd4c4'];

// Player faces: picked on join (first free one) and changeable in the lobby.
// Shown inside the player's colour circle on every phone and the TV.
export const AVATARS = [
  '🦊', '🐸', '🐙', '🐼', '🐯', '🐵', '🐨', '🐷', '🦁', '🐻', '🐰', '🐔',
  '🦖', '🐝', '👽', '🤖', '👻', '🦄', '🐳', '🦉', '🐮', '🦝', '🐲', '🌵',
];
