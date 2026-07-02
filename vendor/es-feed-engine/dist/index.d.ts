/**
 * EssentiallySports — Social Feed Engine  v1.0
 * TypeScript declarations
 */

export type FeedSource = 'twitter' | 'instagram' | 'es' | 'youtube';

export interface TweetData {
  text?: string;
  favorite_count?: number;
  conversation_count?: number;
  user?: {
    name?: string;
    screen_name?: string;
    profile_image_url_https?: string;
  };
  video?: {
    poster?: string;
    variants?: Array<{ type: string; src: string; bitrate?: number }>;
  };
  mediaDetails?: Array<{ media_url_https?: string }>;
}

export interface TwitterItem {
  source: 'twitter';
  views: string;
  likes: string;
  text: string;
  handle: string;
  url: string;
  timestamp: string;
  tweetData?: TweetData;
  editorialCaption?: string;
}

export interface InstagramItem {
  source: 'instagram';
  views: string;
  likes: string;
  text: string;
  handle: string;
  url: string;
  timestamp: string;
  ogImage?: string;
  editorialCaption?: string;
}

export interface ESItem {
  source: 'es';
  text: string;
  url: string;
  timestamp: string;
  ogImage?: string;
  description?: string;
  editorialCaption?: string;
}

export interface YouTubeItem {
  source: 'youtube';
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  views: number;
  publishedAt: string;
  editorialCaption?: string;
}

export type AllFeedItem = TwitterItem | InstagramItem | ESItem | YouTubeItem;

export interface FeedRun {
  time: string;
  label: string;
  sport: string;
  items: Array<TwitterItem | InstagramItem | ESItem>;
}

export interface BuildFeedOptions {
  feedFileContent: string;
  feedFileName: string;
  youtubeApiKey?: string;
  withTweetData?: boolean;
  withESImages?: boolean;
  withCaptions?: boolean;
}

export interface BuildFeedResult {
  items: AllFeedItem[];
  sport: string;
  totalCount: number;
  lastRun: string;
}

export declare const CONFIG: {
  MIN_TWITTER_LIKES: number;
  MIN_INSTAGRAM_LIKES: number;
  MIN_YOUTUBE_VIEWS: number;
  PRIORITY_PLAYERS: string[][];
  VERIFIED_YOUTUBE_CHANNELS: string[];
  YOUTUBE_WINDOW_HOURS: number;
  YOUTUBE_WINDOW_EXTENDED_HOURS: number;
  ES_ARTICLE_INTERVAL: number;
  REFRESH_INTERVAL_MS: number;
};

export declare function parseFeedFile(content: string, filename: string): FeedRun[];
export declare function fetchYouTubeVideos(query: string, apiKey: string): Promise<YouTubeItem[]>;
export declare function buildYouTubeQuery(sport: string, feedText: string): string;
export declare function prefetchTweetData(items: TwitterItem[]): Promise<void>;
export declare function prefetchESImages(items: ESItem[]): Promise<void>;
export declare function passesEngagementThreshold(item: AllFeedItem): boolean;
export declare function playerPriorityScore(item: AllFeedItem): number;
export declare function trendingScore(item: AllFeedItem): number;
export declare function rankScore(item: AllFeedItem): number;
export declare function mergeFeed(runs: FeedRun[], youtubeItems: YouTubeItem[]): AllFeedItem[];
export declare function generateContextCaption(text: string, source?: FeedSource, seed?: string): string;
export declare function buildFeed(opts: BuildFeedOptions): Promise<BuildFeedResult>;
export declare function startAutoRefresh(
  feedApiUrl: string,
  onNewItems: (allItems: AllFeedItem[], newCount: number) => void,
  intervalMs?: number
): () => void;
