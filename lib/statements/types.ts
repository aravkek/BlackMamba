export type ParsedCharge = {
  postedAt: string;       // ISO date, YYYY-MM-DD
  merchantRaw: string;
  amount: number;         // always positive, in major currency unit
  currency: string;       // default "USD"
  source: string;         // filename
};

export type Augmentation = {
  lastCharge?: { date: string; amount: number; source: string };
  isTrialVerify?: boolean;
};

export type MatchResult = {
  matched: { subscriptionId: string; merchantRaw: string; amount: number }[];
  newSubs: { id: string; service: string; amount: number; sampleMerchantRaw: string }[];
  ignored: { merchantRaw: string; amount: number; reason: string }[];
  trialVerifyCount: number;
};
