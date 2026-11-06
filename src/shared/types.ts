export interface Roster {
  rosterId: number;
  ownerId: string;
  teamName: string;
  avatar?: string;
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  players: string[];
  starters: string[];
  playersPoints?: Record<string, number>;
}

export interface MatchupSide {
  rosterId: number;
  points: number;
  starters: string[];
  playersPoints?: Record<string, number>;
}

export interface Matchup {
  matchupId: number;
  sides: [MatchupSide, MatchupSide?];
}

export type ScoringSettings = Record<string, number>;

export interface PlayerInfo {
  id: string;
  name: string;
  position: string;
  team?: string;
}
