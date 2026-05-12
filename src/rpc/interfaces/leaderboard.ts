import { LeaderboardRow } from './leaderboard-row.js';

export interface Leaderboard {
  name: string;
  rows: Array<LeaderboardRow>;
}
