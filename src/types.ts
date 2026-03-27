export interface UserProfile {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  credits: number;
  lastCheckIn?: string;
  checkInStreak?: number;
}

export interface Comic {
  id: string;
  uid: string;
  imageUrl: string;
  prompt: string;
  style: string;
  createdAt: string;
}

export const STYLES = [
  { id: 'xilam', name: 'Xilam Anime', description: 'Vibrant, bold lines, expressive characters' },
  { id: 'takashi', name: "Takashi Yanase's Anime", description: 'Soft, rounded, friendly, nostalgic' },
  { id: 'ghibli', name: 'Studio Ghibli', description: 'Detailed, painterly, whimsical, lush environments' },
];

export const DAILY_CREDITS = [10, 10, 100, 100, 1000];
export const COMIC_COST = 10;
